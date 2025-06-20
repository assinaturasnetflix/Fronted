// server.js

// --- 1. IMPORTAÇÕES E CONFIGURAÇÃO INICIAL ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// Importa os modelos e as rotas
const apiRoutes = require('./routes.js');
const { Game, User } = require('./models.js');
// Importaremos a lógica do jogo do controllers.js quando estiver pronta
// const { handlePlayerMove, handlePlayerResignation } = require('./controllers.js');

const app = express();
const server = http.createServer(app);

// --- 2. CONFIGURAÇÃO DO CORS E MIDDLEWARES ---
// Habilita CORS para permitir que o frontend (em outro domínio) acesse a API
app.use(cors({
    origin: '*', // Em produção, mude para o domínio do seu frontend: 'http://seu-dominio.com'
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Habilita o parsing de JSON no corpo das requisições
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- 3. CONEXÃO COM O BANCO DE DADOS MONGODB ATLAS ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Conectado com Sucesso!');
    } catch (error) {
        console.error(`Erro ao conectar com MongoDB: ${error.message}`);
        process.exit(1); // Sai do processo com falha
    }
};

connectDB();


// --- 4. CONFIGURAÇÃO DO WEBSOCKET (SOCKET.IO) ---
const io = new Server(server, {
    cors: {
        origin: '*', // Em produção, mude para o domínio do seu frontend
        methods: ['GET', 'POST'],
    },
    // Aumenta o tempo limite de ping para evitar desconexões em redes lentas
    pingTimeout: 60000, 
});

// Disponibiliza o `io` para ser usado nos controllers (para emitir eventos a partir de rotas HTTP)
// Ex: req.app.get('socketio').emit(...)
app.set('socketio', io);


io.on('connection', (socket) => {
    console.log(`🔌 Novo cliente conectado: ${socket.id}`);

    // Evento para entrar no lobby principal e receber atualizações
    socket.on('joinLobby', () => {
        socket.join('lobby_room');
        console.log(`Cliente ${socket.id} entrou no lobby.`);
    });

    // Evento quando um jogador entra em uma sala de jogo específica
    socket.on('joinGameRoom', async ({ gameId, userId }) => {
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                socket.emit('error', { message: 'Jogo não encontrado.' });
                return;
            }
            // Coloca o socket na sala específica do jogo
            socket.join(gameId);
            console.log(`Cliente ${socket.id} (Usuário: ${userId}) entrou na sala do jogo: ${gameId}`);
            
            // Notifica o outro jogador que o oponente se conectou
            socket.to(gameId).emit('opponentConnected', { userId });

        } catch (error) {
            console.error(error);
            socket.emit('error', { message: 'Erro ao entrar na sala do jogo.' });
        }
    });

    // Evento para lidar com uma jogada feita por um jogador
    socket.on('makeMove', async (data) => {
        const { gameId, userId, move } = data; // move = { from: {row, col}, to: {row, col} }
        console.log(`Jogada recebida no jogo ${gameId} pelo usuário ${userId}:`, move);
        
        // AQUI VIRÁ A LÓGICA DO JOGO DO controllers.js
        // Por enquanto, vamos simular a resposta
        // const result = await handlePlayerMove(gameId, userId, move);
        
        // Simulação de resposta:
        // Se a jogada for válida, o 'handlePlayerMove' retornaria o estado atualizado do jogo.
        // E então emitiríamos para a sala.
        const game = await Game.findById(gameId).populate('players');
        if (game) {
            // Emite a jogada para todos na sala (incluindo quem enviou, para confirmação)
            io.to(gameId).emit('moveMade', { 
                newBoardState: move, // No futuro, será o estado completo do tabuleiro
                nextPlayer: game.players.find(p => p._id.toString() !== userId)._id,
            });
            console.log(`Jogada transmitida para a sala ${gameId}`);
        }
    });

    // Evento para quando um jogador desiste da partida
    socket.on('resignGame', async ({ gameId, userId }) => {
        console.log(`Usuário ${userId} desistiu do jogo ${gameId}`);
        
        // AQUI VIRÁ A LÓGICA DE DESISTÊNCIA DO controllers.js
        // const result = await handlePlayerResignation(gameId, userId);

        // if (result.success) {
        //     io.to(gameId).emit('gameOver', result.data); // result.data conteria o vencedor, perdedor, etc.
        // } else {
        //     socket.emit('error', { message: result.message });
        // }
    });

    // Lida com desconexões
    socket.on('disconnect', () => {
        console.log(`🔌 Cliente desconectado: ${socket.id}`);
        // Aqui, você pode adicionar lógica para lidar com uma desconexão no meio de um jogo,
        // como iniciar um cronômetro para o jogador se reconectar ou declarar o outro como vencedor.
    });
});


// --- 5. ROTAS DA API ---
// Usa o roteador importado de `routes.js` com o prefixo /api
app.use('/api', apiRoutes);


// --- 6. MIDDLEWARES DE ERRO (DEVEM SER OS ÚLTIMOS) ---
// Middleware para rotas não encontradas (404)
app.use((req, res, next) => {
    const error = new Error(`Rota não encontrada - ${req.originalUrl}`);
    res.status(404);
    next(error);
});

// Middleware genérico de tratamento de erros
app.use((err, req, res, next) => {
    // Define o status code: se já foi definido, usa ele, senão, 500 (Erro Interno do Servidor)
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    res.json({
        message: err.message,
        // Em ambiente de desenvolvimento, mostra o stack trace do erro
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    });
});


// --- 7. INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em modo ${process.env.NODE_ENV} na porta ${PORT}`);
});