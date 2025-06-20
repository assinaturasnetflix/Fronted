// models.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// =============================
// ESQUEMA DO USUÁRIO (USER)
// =============================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    avatar: { 
        url: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg' },
        public_id: { type: String, default: 'sample' }
    },
    balance: { type: Number, default: 0.00 },
    bio: { type: String, maxlength: 250, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false },
    paymentInfo: {
        mpesaNumber: { type: String, default: '' },
        emolaNumber: { type: String, default: '' }
    },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        totalWinnings: { type: Number, default: 0 }
    },
    // ========================================================
    // >>>>> ADIÇÃO NECESSÁRIA PARA O WEBSOCKET <<<<<
    // ========================================================
    socketId: { type: String, default: null } // Armazena o ID do socket ativo do usuário
    
}, { timestamps: true });

// Middleware para hashear a senha antes de salvar
UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Método para comparar senhas
UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', UserSchema);

// =============================
// ESQUEMA DA SALA DE LOBBY (LOBBYROOM)
// =============================
const LobbyRoomSchema = new mongoose.Schema({
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    betAmount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['waiting', 'playing', 'cancelled'], default: 'waiting' },
    gameType: { type: String, enum: ['public', 'private'], default: 'public' },
    privateCode: { type: String, unique: true, sparse: true },
    message: { type: String, maxlength: 100, default: '' },
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' }
}, { timestamps: true });

const LobbyRoom = mongoose.model('LobbyRoom', LobbyRoomSchema);

// =============================
// ESQUEMA DO JOGO (GAME)
// =============================
const GameSchema = new mongoose.Schema({
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    player1: { id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, color: { type: String, default: 'white' } },
    player2: { id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, color: { type: String, default: 'black' } },
    boardState: { type: String, required: true },
    currentPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['waiting_players', 'ongoing', 'finished', 'cancelled'], default: 'waiting_players' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    endReason: { type: String, enum: ['checkmate', 'resignation', 'timeout', 'no_pieces'], default: null },
    betAmount: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },
    moves: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        from: { row: Number, col: Number },
        to: { row: Number, col: Number },
        capturedPieces: [{ row: Number, col: Number }],
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

const Game = mongoose.model('Game', GameSchema);

// =============================
// ESQUEMA DE DEPÓSITO (DEPOSIT)
// =============================
const DepositSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['M-Pesa', 'e-Mola'], required: true },
    transactionRef: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Deposit = mongoose.model('Deposit', DepositSchema);

// =============================
// ESQUEMA DE LEVANTAMENTO (WITHDRAWAL)
// =============================
const WithdrawalSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['M-Pesa', 'e-Mola'], required: true },
    accountNumber: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

// =============================
// ESQUEMA DE CONFIGURAÇÃO DO ADMIN (ADMIN_SETTINGS)
// =============================
const AdminSettingsSchema = new mongoose.Schema({
    singleton: { type: String, default: 'main_settings', unique: true }, 
    minDeposit: { type: Number, default: 50 },
    maxDeposit: { type: Number, default: 10000 },
    minWithdrawal: { type: Number, default: 100 },
    maxWithdrawal: { type: Number, default: 5000 },
    maxBet: { type: Number, default: 2500 },
    platformFeePercentage: { type: Number, default: 10, min: 0, max: 100 },
    paymentInstructions: {
        mpesa: { numbers: [{ number: String, instructions: String }] },
        emola: { numbers: [{ number: String, instructions: String }] }
    },
    platformTexts: {
        welcomeMessage: { type: String, default: 'Bem-vindo ao BrainSkill!' },
        rulesPage: { type: String, default: 'Regras da Dama Brasileira...' }
    }
}, { timestamps: true });

const AdminSettings = mongoose.model('AdminSettings', AdminSettingsSchema);

// Exportando todos os modelos
module.exports = {
    User,
    LobbyRoom,
    Game,
    Deposit,
    Withdrawal,
    AdminSettings
};