// server.js

// --- 1. IMPORTAÇÕES E CONFIGURAÇÃO INICIAL ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const jwt = require('jsonwebtoken');

dotenv.config();

const apiRoutes = require('./routes.js');
const { User, Game } = require('./models.js');
const { 
    handleAcceptChallenge, 
    handlePlayerMove, 
    finishGame 
} = require('./controllers.js');

const app = express();
const server = http.createServer(app);

// --- 2. CONFIGURAÇÃO DO CORS E MIDDLEWARES ---
app.use(cors({
    origin: '*', // Em produção, mude para o domínio do seu frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- 3. CONEXÃO COM O BANCO DE DADOS ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Conectado com Sucesso!');
    } catch (error) {
        console.error(`Erro ao conectar com MongoDB: ${error.message}`);
        process.exit(1);
    }
};
connectDB();


// --- 4. CONFIGURAÇÃO DO WEBSOCKET (SOCKET.IO) ---
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000, 
});
app.set('socketio', io);

// Middleware de autenticação para Socket.IO
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('_id');
            if (user) {
                socket.userId = user._id.toString(); // Anexa o ID do usuário ao socket
                return next();
            }
        } catch (error) {
            console.error("Erro de autenticação no socket:", error.message);
            return next(new Error('Authentication error'));
        }
    }
    return next(new Error('Authentication error'));
});

// Mapeamento em memória para rastrear jogadores por sala de jogo
const gameRooms = {};

io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id} (Usuário: ${socket.userId})`);

    // Registra o socketId no banco para mensagens diretas
    User.findByIdAndUpdate(socket.userId, { socketId: socket.id }).exec();
    
    // Faz o socket entrar em uma sala com seu próprio ID de usuário.
    // Isso permite enviar mensagens diretas para um usuário específico.
    socket.join(socket.userId);
    
    // ================== EVENTOS DO LOBBY ==================
    socket.on('joinLobby', () => {
        socket.join('lobby_room');
    });

    socket.on('acceptChallenge', (data) => {
        handleAcceptChallenge(io, socket, data);
    });

    // ================== EVENTOS DO JOGO (VERSUS E GAME) ==================
    socket.on('joinGameRoom', async ({ gameId }) => {
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                return socket.emit('gameError', { message: 'Jogo não encontrado.' });
            }
            if (!game.players.some(p => p.equals(socket.userId))) {
                return socket.emit('gameError', { message: 'Não autorizado a entrar neste jogo.' });
            }
            
            socket.join(gameId);

            if (!gameRooms[gameId]) gameRooms[gameId] = new Set();
            gameRooms[gameId].add(socket.userId);

            console.log(`Usuário ${socket.userId} entrou na sala do jogo: ${gameId}. Jogadores na sala: ${gameRooms[gameId].size}`);

            const connectedUsers = Array.from(gameRooms[gameId]);
            io.to(gameId).emit('roomStatus', { connectedUsers });

            if (gameRooms[gameId].size === 1 && game.status === 'waiting_players') {
                socket.emit('startCountdown');
            }

        } catch (error) {
            console.error(error);
            socket.emit('gameError', { message: 'Erro ao entrar na sala do jogo.' });
        }
    });
    
    socket.on('playersReady', async ({ gameId }) => {
        await Game.findByIdAndUpdate(gameId, { status: 'ongoing' });
        io.to(gameId).emit('startGame');
    });

    socket.on('makeMove', (data) => {
        handlePlayerMove(io, socket, data);
    });

    socket.on('resignGame', async ({ gameId }) => {
        const game = await Game.findById(gameId);
        if (game && game.status === 'ongoing') {
            const winnerId = game.players.find(p => !p.equals(socket.userId));
            const loserId = socket.userId;
            await finishGame(io, game, winnerId, loserId, 'resignation');
        }
    });

    socket.on('cancelGameByTimeout', async ({ gameId }) => {
        console.log(`Jogo ${gameId} cancelado por timeout.`);
        const game = await Game.findById(gameId);
        if (game && (game.status === 'waiting_players')) {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                for (const playerId of game.players) {
                    await User.findByIdAndUpdate(playerId, { $inc: { balance: game.betAmount } }, { session });
                }
                game.status = 'cancelled';
                game.endReason = 'timeout';
                await game.save({ session });
                await session.commitTransaction();
                io.to(gameId).emit('gameCancelled', { message: 'O oponente não se conectou a tempo. A partida foi cancelada e o valor da aposta foi devolvido.' });
            } catch (error) {
                await session.abortTransaction();
                console.error("Erro ao cancelar jogo por timeout:", error);
            } finally {
                session.endSession();
            }
        }
    });
    
    // ================== DESCONEXÃO ==================
    socket.on('disconnect', () => {
        console.log(`🔌 Cliente desconectado: ${socket.id} (Usuário: ${socket.userId})`);
        if (socket.userId) {
            User.findByIdAndUpdate(socket.userId, { socketId: null }).exec();
            
            for (const gameId in gameRooms) {
                if (gameRooms[gameId].has(socket.userId)) {
                    gameRooms[gameId].delete(socket.userId);
                    console.log(`Usuário ${socket.userId} removido da sala ${gameId}`);
                    // Adicionar lógica aqui para lidar com abandono de partida em andamento
                    if (gameRooms[gameId].size === 0) {
                        delete gameRooms[gameId];
                    }
                    break;
                }
            }
        }
    });
});


// --- 5. ROTAS DA API ---
app.use('/api', apiRoutes);


// --- 6. MIDDLEWARES DE ERRO ---
app.use((req, res, next) => {
    const error = new Error(`Rota não encontrada - ${req.originalUrl}`);
    res.status(404);
    next(error);
});

app.use((err, req, res, next) => {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    res.json({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    });
});


// --- 7. INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em modo ${process.env.NODE_ENV} na porta ${PORT}`);
});