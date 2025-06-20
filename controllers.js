// controllers.js

// --- 1. IMPORTAÇÕES ---
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const asyncHandler = require('express-async-handler');

// Importa todos os modelos
const { User, Game, Deposit, Withdrawal, LobbyRoom, AdminSettings } = require('./models.js');

// --- 2. CONFIGURAÇÕES DE SERVIÇOS EXTERNOS ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// --- 3. FUNÇÕES HELPER ---
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const sendPasswordResetEmail = async (email, token, username) => {
    const emailHtml = `
    <div style="font-family: 'Poppins', sans-serif; background-color: #f4f4f4; padding: 20px; text-align: center;">
        <div style="max-width: 600px; margin: auto; background-color: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
            <div style="background-color: #4a2c2a; color: white; padding: 20px;">
                <h1 style="margin: 0; font-size: 28px;">BrainSkill</h1>
            </div>
            <div style="padding: 30px; color: #555; text-align: left; line-height: 1.6;">
                <h2 style="color: #4a2c2a;">Olá, ${username}!</h2>
                <p>Use o código abaixo para criar uma nova senha. Este código é válido por <strong>15 minutos</strong>.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="display: inline-block; background-color: #8b5e3c; color: white; padding: 15px 30px; font-size: 24px; letter-spacing: 5px; border-radius: 5px;">
                        ${token}
                    </span>
                </div>
                <p>Se não foi você, pode ignorar este e-mail.</p>
            </div>
            <div style="background-color: #f0e5d8; color: #8b5e3c; padding: 15px; font-size: 12px;">© ${new Date().getFullYear()} BrainSkill.</div>
        </div>
    </div>`;
    await transporter.sendMail({
        from: process.env.EMAIL_FROM, to: email, subject: 'Recuperação de Senha - BrainSkill', html: emailHtml
    });
};

// --- 4. MIDDLEWARES ---
const protect = asyncHandler(async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user || req.user.isBlocked) {
                res.status(401);
                throw new Error('Não autorizado, utilizador bloqueado ou token inválido.');
            }
            next();
        } catch (error) {
            res.status(401);
            throw new Error('Não autorizado, token falhou.');
        }
    }
    if (!token) {
        res.status(401);
        throw new Error('Não autorizado, sem token.');
    }
});

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403);
        throw new Error('Acesso negado. Apenas administradores.');
    }
};

// =================================================================
// --- 5. LÓGICA DO JOGO DE DAMAS BRASILEIRAS (BACKEND) ---
// =================================================================
const initializeBoard = () => {
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 8; c++) { if ((r + c) % 2 !== 0) board[r][c] = 'b'; } }
    for (let r = 5; r < 8; r++) { for (let c = 0; c < 8; c++) { if ((r + c) % 2 !== 0) board[r][c] = 'w'; } }
    return board;
};
const isValidSquare = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

function findAllPossibleMoves(board, playerColor) {
    let allCaptures = [];
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.toLowerCase().startsWith(playerColor[0])) {
            const sequences = findCaptureSequencesForPiece(board, r, c);
            sequences.forEach(seq => allCaptures.push({ from: {row: r, col: c}, to: seq.path[seq.path.length-1], path: seq.path, captures: seq.captures }));
        }
    }}
    if (allCaptures.length > 0) {
        const max = Math.max(...allCaptures.map(m => m.captures.length));
        return allCaptures.filter(m => m.captures.length === max);
    }
    let simpleMoves = [];
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.toLowerCase().startsWith(playerColor[0])) {
            simpleMoves.push(...findSimpleMovesForPiece(board, r, c));
        }
    }}
    return simpleMoves;
}

function findCaptureSequencesForPiece(board, r, c, path = [], captures = []) {
    const piece = board[r][c]; if (!piece) return [];
    let finalSequences = [];
    const playerColor = piece.toLowerCase().startsWith('w') ? 'white' : 'black';
    const opponentColor = playerColor === 'white' ? 'black' : 'white';
    const isKing = piece !== piece.toLowerCase();

    for (const [dr, dc] of [[-1,-1], [-1,1], [1,-1], [1,1]]) {
        if (isKing) {
            for (let i = 1; i < 8; i++) {
                const opponentR = r + dr * i, opponentC = c + dc * i;
                if (!isValidSquare(opponentR, opponentC)) break;
                const midPiece = board[opponentR][opponentC];
                if (midPiece) {
                    if (midPiece.toLowerCase().startsWith(opponentColor[0]) && !captures.some(cap => cap.row === opponentR && cap.col === opponentC)) {
                        for (let j = 1; j < 8; j++) {
                            const landR = opponentR + dr * j, landC = opponentC + dc * j;
                            if (!isValidSquare(landR, landC) || board[landR][landC]) break;
                            const newBoard = JSON.parse(JSON.stringify(board));
                            newBoard[r][c] = null; newBoard[opponentR][opponentC] = null; newBoard[landR][landC] = piece;
                            const newPath = [...path, { row: landR, col: landC }];
                            const newCaptures = [...captures, { row: opponentR, col: opponentC }];
                            const deeperSequences = findCaptureSequencesForPiece(newBoard, landR, landC, newPath, newCaptures);
                            if(deeperSequences.length > 0) finalSequences.push(...deeperSequences); else finalSequences.push({ path: newPath, captures: newCaptures });
                        }
                    }
                    break;
                }
            }
        } else { // Lógica do Peão
            const opponentR = r + dr, opponentC = c + dc;
            const landR = r + dr * 2, landC = c + dc * 2;
            if (isValidSquare(landR, landC) && !board[landR][landC]) {
                const midPiece = board[opponentR][opponentC];
                if (midPiece && midPiece.toLowerCase().startsWith(opponentColor[0])) {
                    const newBoard = JSON.parse(JSON.stringify(board));
                    newBoard[r][c] = null; newBoard[opponentR][opponentC] = null; newBoard[landR][landC] = piece;
                    const newPath = [...path, { row: landR, col: landC }];
                    const newCaptures = [...captures, { row: opponentR, col: opponentC }];
                    const deeperSequences = findCaptureSequencesForPiece(newBoard, landR, landC, newPath, newCaptures);
                    if(deeperSequences.length > 0) finalSequences.push(...deeperSequences); else finalSequences.push({ path: newPath, captures: newCaptures });
                }
            }
        }
    }
    return finalSequences;
}

function findSimpleMovesForPiece(board, r, c) {
    const piece = board[r][c]; const moves = [];
    const playerColor = piece.toLowerCase().startsWith('w') ? 'white' : 'black';
    const isKing = piece !== piece.toLowerCase();
    if (isKing) {
        for (const [dr, dc] of [[-1,-1], [-1,1], [1,-1], [1,1]]) {
            for (let i = 1; i < 8; i++) {
                const newR = r + dr * i, newC = c + dc * i;
                if (!isValidSquare(newR, newC) || board[newR][newC]) break;
                moves.push({ from: {row: r, col: c}, to: {row: newR, col: newC}, path: [{row: newR, col: newC}], captures: [] });
            }
        }
    } else {
        const forwardDir = playerColor === 'white' ? -1 : 1;
        for (const dc of [-1, 1]) {
            const newR = r + forwardDir, newC = c + dc;
            if (isValidSquare(newR, newC) && !board[newR][newC]) {
                moves.push({ from: {row: r, col: c}, to: {row: newR, col: newC}, path: [{row: newR, col: newC}], captures: [] });
            }
        }
    }
    return moves;
}

// =================================================================
// --- 6. HANDLERS DE SOCKET.IO E API ---
// =================================================================

const handlePlayerMove = async (io, socket, data) => {
    const { gameId, move } = data;
    const userId = socket.userId;

    try {
        const game = await Game.findById(gameId);
        if (!game || game.status !== 'ongoing') throw new Error("Jogo não encontrado ou finalizado.");
        if (game.currentPlayer.toString() !== userId) throw new Error("Não é a sua vez de jogar.");

        const board = JSON.parse(game.boardState);
        const playerColor = game.player1.id.equals(userId) ? 'white' : 'black';
        
        const possibleMoves = findAllPossibleMoves(board, playerColor);
        const receivedMove = possibleMoves.find(
            m => m.from.row === move.from.row && m.from.col === move.from.col && m.to.row === move.to.row && m.to.col === move.to.col
        );

        if (!receivedMove) throw new Error("Movimento inválido.");
        
        const piece = board[receivedMove.from.row][receivedMove.from.col];
        board[receivedMove.from.row][receivedMove.from.col] = null;
        receivedMove.captures.forEach(cap => board[cap.row][cap.col] = null);
        
        let promoted = false;
        if ((playerColor === 'white' && receivedMove.to.row === 0) || (playerColor === 'black' && receivedMove.to.row === 7)) {
            if (piece === piece.toLowerCase()) {
                promoted = true;
                board[receivedMove.to.row][receivedMove.to.col] = piece.toUpperCase();
            } else {
                 board[receivedMove.to.row][receivedMove.to.col] = piece;
            }
        } else {
            board[receivedMove.to.row][receivedMove.to.col] = piece;
        }

        game.boardState = JSON.stringify(board);
        game.moves.push({ player: userId, from: receivedMove.from, to: receivedMove.to, capturedPieces: receivedMove.captures });
        const opponentId = game.players.find(p => !p.equals(userId));
        game.currentPlayer = opponentId;

        const opponentColor = playerColor === 'white' ? 'black' : 'white';
        const opponentMoves = findAllPossibleMoves(board, opponentColor);
        const opponentPieceCount = board.flat().filter(p => p && p.toLowerCase().startsWith(opponentColor[0])).length;

        if (opponentMoves.length === 0 || opponentPieceCount === 0) {
            await finishGame(io, game, userId, opponentId, opponentMoves.length === 0 ? 'checkmate' : 'no_pieces');
        } else {
            await game.save();
            io.to(gameId).emit('moveMade', {
                boardState: game.boardState,
                lastMove: receivedMove,
                currentPlayer: game.currentPlayer
            });
        }
    } catch (error) {
        console.error("Erro na jogada:", error.message);
        socket.emit('gameError', { message: error.message });
    }
};

const finishGame = async (io, game, winnerId, loserId, reason) => {
    if (game.status === 'finished') return;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).session(session);
        const feePercentage = (settings?.platformFeePercentage || 10) / 100;
        
        const totalPot = game.betAmount * 2;
        const platformFee = totalPot * feePercentage;
        const prize = totalPot - platformFee;

        game.status = 'finished';
        game.winner = winnerId;
        game.loser = loserId;
        game.endReason = reason;
        game.platformFee = platformFee;

        const winner = await User.findById(winnerId).session(session);
        winner.balance += prize;
        winner.stats.wins += 1;
        winner.stats.totalWinnings += (prize - game.betAmount);

        const loser = await User.findById(loserId).session(session);
        loser.stats.losses += 1;
        
        await game.save({ session });
        await winner.save({ session });
        await loser.save({ session });
        
        await session.commitTransaction();
        session.endSession();

        const populatedGame = await Game.findById(game._id).populate('winner loser', 'username');
        io.to(game.id).emit('gameOver', {
            winner: populatedGame.winner.username,
            loser: populatedGame.loser.username,
            reason: populatedGame.endReason,
            prize: prize,
            platformFee: platformFee
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erro ao finalizar jogo:", error.message);
    }
};

const handleAcceptChallenge = async (io, socket, data) => {
    const { lobbyId } = data;
    const challengerId = socket.userId;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const lobby = await LobbyRoom.findById(lobbyId).session(session);
        if (!lobby || lobby.status !== 'waiting') throw new Error("Aposta não disponível.");
        if (lobby.creator.equals(challengerId)) throw new Error("Não pode jogar contra si mesmo.");

        const creator = await User.findById(lobby.creator).session(session);
        const challenger = await User.findById(challengerId).session(session);
        if (challenger.balance < lobby.betAmount) throw new Error("Saldo insuficiente.");
        
        challenger.balance -= lobby.betAmount;
        await challenger.save({ session });

        const newGame = new Game({
            players: [creator._id, challenger._id],
            player1: { id: creator._id, color: 'white' },
            player2: { id: challenger._id, color: 'black' },
            boardState: JSON.stringify(initializeBoard()),
            currentPlayer: creator._id,
            status: 'waiting_players',
            betAmount: lobby.betAmount,
        });
        await newGame.save({ session });

        lobby.status = 'playing';
        lobby.gameId = newGame._id;
        await lobby.save({ session });

        await session.commitTransaction();
        session.endSession();

        io.to('lobby_room').emit('lobby_room_removed', lobbyId);

        // Notifica ambos os jogadores para irem para a tela de versus, usando a sala pessoal de cada um
        io.to(lobby.creator.toString()).emit('gameChallengeAccepted', { gameId: newGame._id });
        io.to(challengerId).emit('gameChallengeAccepted', { gameId: newGame._id });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Erro ao aceitar desafio:", error.message);
        socket.emit('gameError', { message: error.message });
    }
};

// --- 7. CONTROLADORES DE API REST ---
const registerUser = asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) { res.status(400); throw new Error('Por favor, preencha todos os campos.'); }
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) { res.status(400); throw new Error('Utilizador com este email ou nome de utilizador já existe.'); }
    const user = await User.create({ username, email, password });
    if (user) {
        res.status(201).json({
            _id: user._id, username: user.username, email: user.email,
            avatar: user.avatar, balance: user.balance, token: generateToken(user._id),
        });
    } else { res.status(400); throw new Error('Dados de utilizador inválidos.'); }
});

const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
        if (user.isBlocked) { res.status(403); throw new Error('Esta conta foi bloqueada.'); }
        res.json({
            _id: user._id, username: user.username, email: user.email,
            role: user.role, avatar: user.avatar.url, balance: user.balance, token: generateToken(user._id),
        });
    } else { res.status(401); throw new Error('Email ou senha inválidos.'); }
});

const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) { res.status(404); throw new Error('Utilizador não encontrado.'); }
    const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();
    try {
        await sendPasswordResetEmail(user.email, resetToken, user.username);
        res.json({ message: 'Email de recuperação enviado.' });
    } catch (error) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.status(500); throw new Error('Erro ao enviar o email.');
    }
});

const resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetPasswordToken: hashedToken, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) { res.status(400); throw new Error('Código inválido ou expirado.'); }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Senha redefinida com sucesso.' });
});

const getUserProfile = asyncHandler(async (req, res) => { res.json(req.user); });

const updateUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    if (user) {
        user.username = req.body.username || user.username;
        user.bio = req.body.bio !== undefined ? req.body.bio : user.bio;
        user.paymentInfo.mpesaNumber = req.body.mpesaNumber || user.paymentInfo.mpesaNumber;
        user.paymentInfo.emolaNumber = req.body.emolaNumber || user.paymentInfo.emolaNumber;
        const updatedUser = await user.save();
        res.json({
            _id: updatedUser._id, username: updatedUser.username, email: updatedUser.email,
            avatar: updatedUser.avatar, bio: updatedUser.bio, paymentInfo: updatedUser.paymentInfo
        });
    } else { res.status(404); throw new Error('Utilizador não encontrado.'); }
});

const uploadAvatar = asyncHandler(async (req, res) => {
    if (!req.file) { res.status(400); throw new Error('Nenhum ficheiro de imagem foi enviado.'); }
    const user = await User.findById(req.user._id);
    if (user.avatar.public_id && user.avatar.public_id !== 'sample') {
        await cloudinary.uploader.destroy(user.avatar.public_id);
    }
    const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ folder: "brainskill_avatars" }, (error, result) => {
            if (error) reject(error); else resolve(result);
        });
        uploadStream.end(req.file.buffer);
    });
    user.avatar.url = result.secure_url;
    user.avatar.public_id = result.public_id;
    await user.save();
    res.json({ message: 'Avatar atualizado com sucesso!', url: result.secure_url });
});

const getPublicProfile = asyncHandler(async (req, res) => {
    const user = await User.findOne({ username: req.params.username }).select('-password -email -paymentInfo -balance -role -resetPasswordToken -resetPasswordExpires');
    if (user) res.json(user); else { res.status(404); throw new Error('Utilizador não encontrado.'); }
});

const getRanking = asyncHandler(async (req, res) => {
    const users = await User.find({ role: 'user' }).sort({ 'stats.totalWinnings': -1 }).limit(100).select('username avatar stats.wins stats.losses stats.totalWinnings');
    res.json(users);
});

const createLobbyRoom = asyncHandler(async (req, res) => {
    const { betAmount, gameType, privateCode, message } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const user = await User.findById(req.user._id).session(session);
        const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).session(session);
        if (!betAmount || betAmount <= 0) throw new Error("Aposta deve ser positiva.");
        if (settings && betAmount > settings.maxBet) throw new Error(`Aposta máxima é ${settings.maxBet} MT.`);
        if (user.balance < betAmount) throw new Error('Saldo insuficiente.');
        user.balance -= betAmount;
        await user.save({ session });
        const lobbyData = { creator: req.user._id, betAmount, gameType, message };
        if (gameType === 'private') {
            if(!privateCode) throw new Error('Jogos privados requerem código.');
            lobbyData.privateCode = privateCode;
        }
        const newLobby = (await LobbyRoom.create([lobbyData], { session }))[0];
        await session.commitTransaction();
        const populatedLobby = await newLobby.populate('creator', 'username avatar');
        req.app.get('socketio').to('lobby_room').emit('new_lobby_room', populatedLobby);
        res.status(201).json(populatedLobby);
    } catch (error) {
        await session.abortTransaction();
        res.status(400).json({ message: error.message });
    } finally {
        session.endSession();
    }
});

const getPublicLobbies = asyncHandler(async (req, res) => {
    const lobbies = await LobbyRoom.find({ status: 'waiting', gameType: 'public' }).populate('creator', 'username avatar').sort({ createdAt: -1 });
    res.json(lobbies);
});

const findPrivateLobbyByCode = asyncHandler(async (req, res) => {
    const lobby = await LobbyRoom.findOne({ privateCode: req.params.code, status: 'waiting' }).populate('creator', 'username avatar');
    if(lobby) res.json(lobby); else res.status(404).json({ message: 'Nenhum jogo encontrado com este código.'});
});

const getGameHistory = asyncHandler(async (req, res) => {
    const games = await Game.find({ players: req.user._id, status: 'finished' }).populate('players', 'username avatar').sort({ updatedAt: -1 });
    res.json(games);
});

const getGameDetails = asyncHandler(async (req, res) => {
    const game = await Game.findById(req.params.id)
        .populate({
            path: 'players',
            select: 'username avatar'
        })
        .populate({
            path: 'player1.id',
            select: 'username avatar'
        })
        .populate({
            path: 'player2.id',
            select: 'username avatar'
        })
        .populate({
            path: 'winner',
            select: 'username'
        });

    if (!game) { 
        res.status(404);
        throw new Error("Jogo não encontrado."); 
    }
    if (!game.players.some(p => p._id.equals(req.user._id)) && req.user.role !== 'admin') {
        res.status(403);
        throw new Error("Não autorizado a ver este jogo.");
    }
    res.json(game);
});

const getActiveGameNotification = asyncHandler(async (req, res) => {
    const activeGame = await Game.findOne({ players: req.user._id, status: 'ongoing' });
    if(activeGame) res.json({ hasActiveGame: true, gameId: activeGame._id }); else res.json({ hasActiveGame: false });
});

const requestDeposit = asyncHandler(async (req, res) => {
    const { amount, method, transactionRef } = req.body;
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' });
    if (!amount || !method || !transactionRef) { res.status(400); throw new Error("Campos obrigatórios."); }
    if (settings && (amount < settings.minDeposit || amount > settings.maxDeposit)) {
        res.status(400); throw new Error(`Depósito entre ${settings.minDeposit} e ${settings.maxDeposit} MT.`);
    }
    const deposit = await Deposit.create({ user: req.user._id, amount, method, transactionRef });
    res.status(201).json({ message: 'Pedido de depósito enviado.', deposit });
});

const requestWithdrawal = asyncHandler(async (req, res) => {
    const { amount, method, accountNumber } = req.body;
    const user = await User.findById(req.user._id);
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' });
    if (!amount || !method || !accountNumber) { res.status(400); throw new Error("Campos obrigatórios."); }
    if (settings && (amount < settings.minWithdrawal || amount > settings.maxWithdrawal)) {
        res.status(400); throw new Error(`Levantamento entre ${settings.minWithdrawal} e ${settings.maxWithdrawal} MT.`);
    }
    if (user.balance < amount) { res.status(400); throw new Error("Saldo insuficiente."); }
    user.balance -= amount;
    await user.save();
    const withdrawal = await Withdrawal.create({ user: req.user._id, amount, method, accountNumber });
    res.status(201).json({ message: 'Pedido de levantamento enviado.', withdrawal });
});

const getTransactionHistory = asyncHandler(async (req, res) => {
    const deposits = await Deposit.find({ user: req.user._id }).sort({ createdAt: -1 });
    const withdrawals = await Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ deposits, withdrawals });
});

const getPaymentInstructions = asyncHandler(async (req, res) => {
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).select('paymentInstructions');
    if(settings) res.json(settings.paymentInstructions); else res.status(404).json({ message: "Instruções não configuradas."});
});

// --- 10. CONTROLADORES DE ADMINISTRAÇÃO ---
const adminGetAllUsers = asyncHandler(async (req, res) => {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json(users);
});
const adminToggleUserBlock = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if(user){ user.isBlocked = !user.isBlocked; await user.save(); res.json({ message: `Utilizador ${user.isBlocked ? 'bloqueado' : 'desbloqueado'}.` });}
    else { res.status(404); throw new Error('Utilizador não encontrado.'); }
});
const adminAdjustUserBalance = asyncHandler(async (req, res) => {
    const { amount } = req.body;
    const user = await User.findById(req.params.id);
    if(user){ user.balance += Number(amount); await user.save(); res.json({ message: `Saldo ajustado. Novo saldo: ${user.balance.toFixed(2)} MT.` });}
    else { res.status(404); throw new Error('Utilizador não encontrado.'); }
});
const adminGetDeposits = asyncHandler(async (req, res) => {
    const deposits = await Deposit.find({}).populate('user', 'username email').sort({ createdAt: -1 });
    res.json(deposits);
});
const adminProcessDeposit = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit || deposit.status !== 'pending') { res.status(400); throw new Error('Pedido não encontrado ou já processado.'); }
    if (status === 'approved') {
        const user = await User.findById(deposit.user);
        user.balance += deposit.amount;
        await user.save();
        deposit.status = 'approved';
    } else { deposit.status = 'rejected'; }
    deposit.processedBy = req.user._id;
    await deposit.save();
    res.json({ message: `Depósito ${status}.`, deposit });
});
const adminGetWithdrawals = asyncHandler(async (req, res) => {
    const withdrawals = await Withdrawal.find({}).populate('user', 'username email').sort({ createdAt: -1 });
    res.json(withdrawals);
});
const adminProcessWithdrawal = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.status !== 'pending') { res.status(400); throw new Error('Pedido não encontrado ou já processado.'); }
    if (status === 'approved') { withdrawal.status = 'approved'; }
    else {
        const user = await User.findById(withdrawal.user);
        user.balance += withdrawal.amount;
        await user.save();
        withdrawal.status = 'rejected';
    }
    withdrawal.processedBy = req.user._id;
    await withdrawal.save();
    res.json({ message: `Levantamento ${status}.`, withdrawal });
});
const adminGetAllGames = asyncHandler(async (req, res) => {
    const games = await Game.find({}).populate('players', 'username').sort({ createdAt: -1 });
    res.json(games);
});
const adminGetDashboardStats = asyncHandler(async (req, res) => {
    const totalDeposited = (await Deposit.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;
    const totalWithdrawn = (await Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;
    const totalPlatformFees = (await Game.aggregate([{ $match: { status: 'finished', winner: { $ne: null } } }, { $group: { _id: null, total: { $sum: '$platformFee' } } }]))[0]?.total || 0;
    res.json({ totalDeposited, totalWithdrawn, totalPlatformFees });
});
const adminGetSettings = asyncHandler(async (req, res) => {
    let settings = await AdminSettings.findOne({ singleton: 'main_settings' });
    if (!settings) settings = await AdminSettings.create({});
    res.json(settings);
});
const adminUpdateSettings = asyncHandler(async (req, res) => {
    const settings = await AdminSettings.findOneAndUpdate({ singleton: 'main_settings' }, req.body, { new: true, upsert: true });
    res.json({ message: "Configurações atualizadas.", settings });
});

// --- 11. EXPORTAÇÕES ---
module.exports = {
    protect, admin,
    handleAcceptChallenge, handlePlayerMove, finishGame,
    registerUser, loginUser, forgotPassword, resetPassword, getUserProfile, updateUserProfile, uploadAvatar, getPublicProfile, getRanking,
    createLobbyRoom, getPublicLobbies, findPrivateLobbyByCode, getGameHistory, getGameDetails, getActiveGameNotification,
    requestDeposit, requestWithdrawal, getTransactionHistory, getPaymentInstructions,
    adminGetAllUsers, adminToggleUserBlock, adminAdjustUserBalance, adminGetDeposits, adminProcessDeposit, adminGetWithdrawals, adminProcessWithdrawal, adminGetAllGames, adminGetDashboardStats, adminGetSettings, adminUpdateSettings,
};