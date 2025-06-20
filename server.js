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


io.on('connection', (socket) => {
    console.log(`🔌 Cliente conectado: ${socket.id} (Usuário: ${socket.userId})`);

    // Registra o socketId no banco para mensagens diretas
    User.findByIdAndUpdate(socket.userId, { socketId: socket.id }).exec();
    
    // ================== EVENTOS DO LOBBY ==================
    socket.on('joinLobby', () => {
        socket.join('lobby_room');
    });

    socket.on('acceptChallenge', (data) => {
        handleAcceptChallenge(io, socket, data);
    });

    // ================== EVENTOS DO JOGO ==================
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
            console.log(`Usuário ${socket.userId} entrou na sala do jogo: ${gameId}`);
            
            // Notifica o outro jogador que o oponente se conectou
            socket.to(gameId).emit('opponentConnected', { userId: socket.userId });

        } catch (error) {
            console.error(error);
            socket.emit('gameError', { message: 'Erro ao entrar na sala do jogo.' });
        }
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
        // Lógica a ser implementada: cancelar o jogo e devolver o dinheiro
        console.log(`Jogo ${gameId} cancelado por timeout.`);
        const game = await Game.findById(gameId);
        if (game && game.status === 'waiting_players') {
            game.status = 'cancelled';
            await game.save();
            // Lógica para devolver o dinheiro
            io.to(gameId).emit('gameCancelled', { message: 'O oponente não se conectou a tempo. A partida foi cancelada.' });
        }
    });
    
    // ================== DESCONEXÃO ==================
    socket.on('disconnect', () => {
        console.log(`🔌 Cliente desconectado: ${socket.id} (Usuário: ${socket.userId})`);
        if (socket.userId) {
            // Limpa o socketId do usuário no banco de dados para evitar enviar mensagens para sockets mortos
            User.findByIdAndUpdate(socket.userId, { socketId: null }).exec();
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