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

// --- 3. FUNÇÕES HELPER E CONSTANTES DO JOGO ---

const BOARD_SIZE = 8;
const PLAYER_PIECES = { WHITE: 'w', BLACK: 'b' };
const PLAYER_KINGS = { WHITE: 'W', BLACK: 'B' };

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

// --- 4. MIDDLEWARES DE AUTENTICAÇÃO E AUTORIZAÇÃO ---

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
// --- 5. LÓGICA DO JOGO DE DAMAS BRASILEIRAS (NÚCLEO) ---
// =================================================================

const initializeBoard = () => {
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if ((i + j) % 2 !== 0) board[i][j] = PLAYER_PIECES.BLACK; // Peças do oponente
        }
    }
    for (let i = 5; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if ((i + j) % 2 !== 0) board[i][j] = PLAYER_PIECES.WHITE; // Peças do jogador local
        }
    }
    return board;
};

const isWithinBoard = (row, col) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

const getPlayerInfo = (piece) => {
    if (!piece) return null;
    const p = piece.toLowerCase();
    return {
        color: p === PLAYER_PIECES.WHITE ? 'white' : 'black',
        isKing: p !== piece,
    };
};

// Função RECURSIVA para encontrar todas as sequências de captura a partir de uma peça
const findCaptureSequencesForPiece = (board, startRow, startCol, isKing, opponentColor, currentSequence) => {
    const directions = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // Peão também captura para trás
    let finalSequences = [];
    let madeCapture = false;

    for (const [dRow, dCol] of directions) {
        if (isKing) {
            // Lógica para Dama (vôo)
            for (let i = 1; ; i++) {
                const opponentRow = startRow + i * dRow;
                const opponentCol = startCol + i * dCol;
                const landRow = startRow + (i + 1) * dRow;
                const landCol = startCol + (i + 1) * dCol;

                if (!isWithinBoard(opponentRow, opponentCol)) break; // Fora do tabuleiro
                const opponentPiece = board[opponentRow][opponentCol];
                if (opponentPiece && getPlayerInfo(opponentPiece).color !== opponentColor) break; // Bloqueado por peça amiga

                if (opponentPiece && getPlayerInfo(opponentPiece).color === opponentColor) {
                    if (isWithinBoard(landRow, landCol) && !board[landRow][landCol]) {
                        // Salto válido encontrado. Simular o salto e continuar recursivamente.
                        for(let j=1; ;j++){
                            const newLandRow = opponentRow + j*dRow;
                            const newLandCol = opponentCol + j*dCol;
                            if(!isWithinBoard(newLandRow, newLandCol) || board[newLandRow][newLandCol]) break;

                            madeCapture = true;
                            const tempBoard = JSON.parse(JSON.stringify(board));
                            tempBoard[opponentRow][opponentCol] = null;
                            tempBoard[startRow][startCol] = null;
                            tempBoard[newLandRow][newLandCol] = board[startRow][startCol];

                            const newSequence = [...currentSequence, { row: newLandRow, col: newLandCol, captured: { row: opponentRow, col: opponentCol } }];
                            const subSequences = findCaptureSequencesForPiece(tempBoard, newLandRow, newLandCol, isKing, opponentColor, newSequence);
                            finalSequences.push(...subSequences);
                        }
                    }
                    break; // Parar de procurar nesta diagonal após encontrar um oponente
                }
            }
        } else {
            // Lógica para Peão
            const opponentRow = startRow + dRow;
            const opponentCol = startCol + dCol;
            const landRow = startRow + 2 * dRow;
            const landCol = startCol + 2 * dCol;
            
            if (isWithinBoard(landRow, landCol) && board[landRow][landCol] === null) {
                const piece = board[opponentRow][opponentCol];
                if (piece && getPlayerInfo(piece).color === opponentColor) {
                    madeCapture = true;
                    const tempBoard = JSON.parse(JSON.stringify(board));
                    tempBoard[opponentRow][opponentCol] = null;
                    tempBoard[startRow][startCol] = null;
                    tempBoard[landRow][landCol] = board[startRow][startCol];

                    const newSequence = [...currentSequence, { row: landRow, col: landCol, captured: { row: opponentRow, col: opponentCol } }];
                    const subSequences = findCaptureSequencesForPiece(tempBoard, landRow, landCol, isKing, opponentColor, newSequence);
                    finalSequences.push(...subSequences);
                }
            }
        }
    }
    // Se nenhuma captura foi feita a partir desta posição, esta sequência termina aqui.
    if (!madeCapture && currentSequence.length > 0) {
        return [currentSequence];
    }
    return finalSequences;
};

// Função para encontrar todos os movimentos simples (sem captura)
const findSimpleMovesForPiece = (board, startRow, startCol) => {
    const piece = board[startRow][startCol];
    const { color, isKing } = getPlayerInfo(piece);
    const moves = [];
    
    let directions = [];
    if (isKing) {
        directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    } else {
        directions = color === 'white' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    }

    for (const [dRow, dCol] of directions) {
        if(isKing) {
            for(let i=1; ; i++){
                const newRow = startRow + i * dRow;
                const newCol = startCol + i * dCol;
                if (!isWithinBoard(newRow, newCol) || board[newRow][newCol] !== null) break;
                moves.push({ from: {row: startRow, col: startCol}, to: {row: newRow, col: newCol }, captures: [] });
            }
        } else {
            const newRow = startRow + dRow;
            const newCol = startCol + dCol;
            if (isWithinBoard(newRow, newCol) && board[newRow][newCol] === null) {
                moves.push({ from: {row: startRow, col: startCol}, to: {row: newRow, col: newCol }, captures: [] });
            }
        }
    }
    return moves;
};


// Função principal para obter TODOS os movimentos válidos para um jogador
const getAllValidMoves = (board, playerColor) => {
    let allCaptures = [];
    const opponentColor = playerColor === 'white' ? 'black' : 'white';

    // 1. Encontrar todas as sequências de captura possíveis
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && getPlayerInfo(piece).color === playerColor) {
                const { isKing } = getPlayerInfo(piece);
                const sequences = findCaptureSequencesForPiece(board, r, c, isKing, opponentColor, []);
                if (sequences.length > 0) {
                    allCaptures.push(...sequences.map(seq => ({ from: {row: r, col: c}, to: seq[seq.length - 1], captures: seq.map(s => s.captured) })));
                }
            }
        }
    }

    // 2. Aplicar a "Lei da Maioria": se houver capturas, apenas as mais longas são válidas.
    if (allCaptures.length > 0) {
        let maxCaptures = 0;
        for (const move of allCaptures) {
            if (move.captures.length > maxCaptures) {
                maxCaptures = move.captures.length;
            }
        }
        return allCaptures.filter(move => move.captures.length === maxCaptures);
    }

    // 3. Se não houver capturas, encontrar todos os movimentos simples
    let allSimpleMoves = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece && getPlayerInfo(piece).color === playerColor) {
                allSimpleMoves.push(...findSimpleMovesForPiece(board, r, c));
            }
        }
    }
    return allSimpleMoves;
};

// =================================================================
// --- 6. HANDLERS DE SOCKET.IO PARA JOGABILIDADE ---
// =================================================================

/**
 * Lida com um jogador aceitando um desafio no lobby.
 * Cria o jogo, debita saldos e notifica ambos os jogadores.
 */
const handleAcceptChallenge = async (io, data) => {
    const { lobbyRoomId, challengerId } = data;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const lobby = await LobbyRoom.findById(lobbyRoomId).session(session);
        if (!lobby || lobby.status !== 'waiting') {
            throw new Error("Esta aposta já não está disponível.");
        }

        const creator = await User.findById(lobby.creator).session(session);
        const challenger = await User.findById(challengerId).session(session);

        if (challenger.balance < lobby.betAmount) {
            throw new Error("Saldo insuficiente para aceitar esta aposta.");
        }
        
        // Debita o valor da aposta do desafiante (o do criador já foi debitado na criação do lobby)
        challenger.balance -= lobby.betAmount;
        await challenger.save({ session });

        // Cria o jogo
        const newGame = new Game({
            players: [creator._id, challenger._id],
            player1: { id: creator._id, color: 'white' },
            player2: { id: challenger._id, color: 'black' },
            boardState: JSON.stringify(initializeBoard()),
            currentPlayer: creator._id,
            status: 'ongoing',
            betAmount: lobby.betAmount,
        });
        await newGame.save({ session });

        lobby.status = 'playing';
        lobby.gameId = newGame._id;
        await lobby.save({ session });

        await session.commitTransaction();

        // Notifica o lobby para remover a sala
        io.to('lobby_room').emit('lobby_room_removed', lobbyRoomId);

        // Notifica ambos os jogadores para começarem o jogo
        io.to(creator.socketId).emit('gameStarted', { gameId: newGame._id });
        io.to(challenger.socketId).emit('gameStarted', { gameId: newGame._id });

    } catch (error) {
        await session.abortTransaction();
        // TODO: Notificar o usuário do erro via socket
        console.error("Erro ao aceitar desafio:", error.message);
    } finally {
        session.endSession();
    }
};

/**
 * Lida com uma jogada feita por um jogador.
 * Valida o movimento, atualiza o estado do jogo e notifica os jogadores.
 */
const handlePlayerMove = async (io, data) => {
    const { gameId, userId, move } = data; // move: { from: {row, col}, to: {row, col} }

    try {
        const game = await Game.findById(gameId);
        if (!game || game.status !== 'ongoing') return;
        if (game.currentPlayer.toString() !== userId) throw new Error("Não é a sua vez de jogar.");

        const board = JSON.parse(game.boardState);
        const playerColor = game.player1.id.equals(userId) ? game.player1.color : game.player2.color;
        
        const validMoves = getAllValidMoves(board, playerColor);
        const receivedMove = validMoves.find(
            m => m.from.row === move.from.row && m.from.col === move.from.col && m.to.row === move.to.row && m.to.col === move.to.col
        );

        if (!receivedMove) throw new Error("Movimento inválido.");

        // Atualizar o tabuleiro
        const piece = board[move.from.row][move.from.col];
        board[move.from.row][move.from.col] = null;
        
        // Promoção a Dama
        let promoted = false;
        if ((playerColor === 'white' && move.to.row === 0) || (playerColor === 'black' && move.to.row === BOARD_SIZE - 1)) {
            board[move.to.row][move.to.col] = playerColor === 'white' ? PLAYER_KINGS.WHITE : PLAYER_KINGS.BLACK;
            promoted = true;
        } else {
            board[move.to.row][move.to.col] = piece;
        }

        // Remover peças capturadas
        for (const captured of receivedMove.captures) {
            board[captured.row][captured.col] = null;
        }

        // Salvar estado
        game.boardState = JSON.stringify(board);
        game.moves.push({ player: userId, from: move.from, to: move.to, capturedPieces: receivedMove.captures });
        const opponentId = game.players.find(p => !p.equals(userId));
        game.currentPlayer = opponentId;

        // Verificar condição de fim de jogo
        const opponentColor = playerColor === 'white' ? 'black' : 'white';
        const opponentValidMoves = getAllValidMoves(board, opponentColor);
        
        const opponentPieces = board.flat().filter(p => p && getPlayerInfo(p).color === opponentColor);

        if (opponentValidMoves.length === 0 || opponentPieces.length === 0) {
            // Jogo terminado!
            await finishGame(io, game, userId, opponentId, opponentPieces.length === 0 ? 'no_pieces' : 'checkmate');
        } else {
            await game.save();
            io.to(gameId).emit('moveMade', {
                newBoardState: board,
                lastMove: move,
                nextPlayer: opponentId,
                capturedPieces: receivedMove.captures,
                promoted
            });
        }
    } catch (error) {
        console.error("Erro na jogada:", error.message);
        // io.to(socket.id).emit('error', { message: error.message });
    }
};

/**
 * Finaliza o jogo, distribui prêmios e atualiza estatísticas.
 */
const finishGame = async (io, game, winnerId, loserId, reason) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).session(session);
        const feePercentage = (settings?.platformFeePercentage || 10) / 100;
        
        const totalPot = game.betAmount * 2;
        const platformFee = totalPot * feePercentage;
        const prize = totalPot - platformFee;

        // Atualizar dados do jogo
        game.status = 'finished';
        game.winner = winnerId;
        game.loser = loserId;
        game.endReason = reason;
        game.platformFee = platformFee;

        // Atualizar vencedor
        const winner = await User.findById(winnerId).session(session);
        winner.balance += prize;
        winner.stats.wins += 1;
        winner.stats.totalWinnings += (prize - game.betAmount); // Ganhos líquidos

        // Atualizar perdedor
        const loser = await User.findById(loserId).session(session);
        loser.stats.losses += 1;
        
        await game.save({ session });
        await winner.save({ session });
        await loser.save({ session });
        
        await session.commitTransaction();

        io.to(game.id).emit('gameOver', {
            winner: winner.username,
            loser: loser.username,
            reason: reason,
            prize: prize,
            platformFee: platformFee
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Erro ao finalizar jogo:", error.message);
    } finally {
        session.endSession();
    }
};

// ... (Restante dos controladores da API REST permanecem os mesmos) ...

// --- 7. CONTROLADORES DE AUTENTICAÇÃO E USUÁRIO ---
const registerUser = asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        res.status(400); throw new Error('Por favor, preencha todos os campos.');
    }
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
        res.status(400); throw new Error('Utilizador com este email ou nome de utilizador já existe.');
    }
    const user = await User.create({ username, email, password });
    if (user) {
        res.status(201).json({
            _id: user._id, username: user.username, email: user.email, avatar: user.avatar.url, balance: user.balance, token: generateToken(user._id),
        });
    } else {
        res.status(400); throw new Error('Dados de utilizador inválidos.');
    }
});
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
        if (user.isBlocked) {
            res.status(403); throw new Error('Esta conta foi bloqueada por um administrador.');
        }
        res.json({
            _id: user._id, username: user.username, email: user.email, role: user.role, avatar: user.avatar.url, balance: user.balance, token: generateToken(user._id),
        });
    } else {
        res.status(401); throw new Error('Email ou senha inválidos.');
    }
});
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
        res.status(404); throw new Error('Utilizador não encontrado.');
    }
    const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();
    try {
        await sendPasswordResetEmail(user.email, resetToken, user.username);
        res.json({ message: 'Email de recuperação enviado com sucesso.' });
    } catch (error) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.status(500); throw new Error('Erro ao enviar o email de recuperação.');
    }
});
const resetPassword = asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
    });
    if (!user) {
        res.status(400); throw new Error('Código inválido ou expirado.');
    }
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ message: 'Senha redefinida com sucesso.' });
});
const getUserProfile = asyncHandler(async (req, res) => {
    res.json(req.user);
});
const updateUserProfile = asyncHandler(async (req, res) => {
    const { username, bio, mpesaNumber, emolaNumber } = req.body;
    const user = await User.findById(req.user._id);
    if (user) {
        user.username = username || user.username;
        user.bio = bio !== undefined ? bio : user.bio;
        user.paymentInfo.mpesaNumber = mpesaNumber || user.paymentInfo.mpesaNumber;
        user.paymentInfo.emolaNumber = emolaNumber || user.paymentInfo.emolaNumber;
        const updatedUser = await user.save();
        res.json({
            _id: updatedUser._id, username: updatedUser.username, email: updatedUser.email, avatar: updatedUser.avatar.url, bio: updatedUser.bio, paymentInfo: updatedUser.paymentInfo
        });
    } else {
        res.status(404); throw new Error('Utilizador não encontrado.');
    }
});
const uploadAvatar = asyncHandler(async (req, res) => {
    if (!req.file) {
        res.status(400); throw new Error('Nenhum ficheiro de imagem foi enviado.');
    }
    const user = await User.findById(req.user._id);
    if (user.avatar.public_id && user.avatar.public_id !== 'sample') {
        await cloudinary.uploader.destroy(user.avatar.public_id);
    }
    const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ folder: "brainskill_avatars" }, (error, result) => {
            if (error) reject(error);
            resolve(result);
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
    if (user) {
        res.json(user);
    } else {
        res.status(404); throw new Error('Utilizador não encontrado.');
    }
});
const getRanking = asyncHandler(async (req, res) => {
    const users = await User.find({ role: 'user' })
        .sort({ 'stats.totalWinnings': -1 })
        .limit(100)
        .select('username avatar stats.wins stats.losses stats.totalWinnings');
    res.json(users);
});

// --- 8. CONTROLADORES DE LOBBY E JOGO (API REST) ---
const createLobbyRoom = asyncHandler(async (req, res) => {
    const { betAmount, gameType, privateCode, message } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const user = await User.findById(req.user._id).session(session);
        const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).session(session);
        if (!betAmount || betAmount <= 0) throw new Error("O valor da aposta deve ser positivo.");
        if (settings && betAmount > settings.maxBet) throw new Error(`O valor máximo da aposta é ${settings.maxBet} MT.`);
        if (user.balance < betAmount) throw new Error('Saldo insuficiente para criar esta aposta.');
        
        user.balance -= betAmount; // Escrow
        await user.save({ session });

        const lobbyData = { creator: req.user._id, betAmount, gameType, message };
        if (gameType === 'private') {
            if(!privateCode) throw new Error('Jogos privados requerem um código.');
            lobbyData.privateCode = privateCode;
        }
        const newLobby = (await LobbyRoom.create([lobbyData], { session }))[0];
        await session.commitTransaction();

        const populatedLobby = await newLobby.populate('creator', 'username avatar');
        
        const io = req.app.get('socketio');
        io.to('lobby_room').emit('new_lobby_room', populatedLobby);
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
    if(lobby) res.json(lobby);
    else res.status(404).json({ message: 'Nenhum jogo privado encontrado com este código.'});
});
const getGameHistory = asyncHandler(async (req, res) => {
    const games = await Game.find({ players: req.user._id, status: 'finished' }).populate('players', 'username avatar').sort({ updatedAt: -1 });
    res.json(games);
});
const getGameDetails = asyncHandler(async (req, res) => {
    const game = await Game.findById(req.params.id).populate('players', 'username avatar');
    if (!game) { res.status(404); throw new Error("Jogo não encontrado."); }
    if (!game.players.some(p => p._id.equals(req.user._id)) && req.user.role !== 'admin') {
        res.status(403); throw new Error("Não autorizado a ver este jogo.");
    }
    res.json(game);
});
const getActiveGameNotification = asyncHandler(async (req, res) => {
    const activeGame = await Game.findOne({ players: req.user._id, status: 'ongoing' });
    if(activeGame) res.json({ hasActiveGame: true, gameId: activeGame._id });
    else res.json({ hasActiveGame: false });
});

// --- 9. CONTROLADORES DE TRANSAÇÕES FINANCEIRAS ---
const requestDeposit = asyncHandler(async (req, res) => {
    const { amount, method, transactionRef } = req.body;
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' });
    if (!amount || !method || !transactionRef) { res.status(400); throw new Error("Todos os campos são obrigatórios."); }
    if (settings && (amount < settings.minDeposit || amount > settings.maxDeposit)) {
        res.status(400); throw new Error(`O valor do depósito deve estar entre ${settings.minDeposit} e ${settings.maxDeposit} MT.`);
    }
    const deposit = await Deposit.create({ user: req.user._id, amount, method, transactionRef });
    res.status(201).json({ message: 'Pedido de depósito enviado com sucesso.', deposit });
});
const requestWithdrawal = asyncHandler(async (req, res) => {
    const { amount, method, accountNumber } = req.body;
    const user = await User.findById(req.user._id);
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' });
    if (!amount || !method || !accountNumber) { res.status(400); throw new Error("Todos os campos são obrigatórios."); }
    if (settings && (amount < settings.minWithdrawal || amount > settings.maxWithdrawal)) {
        res.status(400); throw new Error(`O valor do levantamento deve estar entre ${settings.minWithdrawal} e ${settings.maxWithdrawal} MT.`);
    }
    if (user.balance < amount) { res.status(400); throw new Error("Saldo insuficiente para este levantamento."); }
    user.balance -= amount;
    await user.save();
    const withdrawal = await Withdrawal.create({ user: req.user._id, amount, method, accountNumber });
    res.status(201).json({ message: 'Pedido de levantamento enviado com sucesso.', withdrawal });
});
const getTransactionHistory = asyncHandler(async (req, res) => {
    const deposits = await Deposit.find({ user: req.user._id }).sort({ createdAt: -1 });
    const withdrawals = await Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ deposits, withdrawals });
});
const getPaymentInstructions = asyncHandler(async (req, res) => {
    const settings = await AdminSettings.findOne({ singleton: 'main_settings' }).select('paymentInstructions');
    if(settings) res.json(settings.paymentInstructions);
    else res.status(404).json({ message: "Instruções de pagamento não configuradas."});
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
    } else {
        deposit.status = 'rejected';
    }
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
    if (status === 'approved') {
        withdrawal.status = 'approved';
    } else {
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
    // Middlewares
    protect, admin,
    // Handlers de Socket.IO
    handleAcceptChallenge, handlePlayerMove, finishGame,
    // Controladores API REST
    registerUser, loginUser, forgotPassword, resetPassword, getUserProfile, updateUserProfile, uploadAvatar, getPublicProfile, getRanking,
    createLobbyRoom, getPublicLobbies, findPrivateLobbyByCode, getGameHistory, getGameDetails, getActiveGameNotification,
    requestDeposit, requestWithdrawal, getTransactionHistory, getPaymentInstructions,
    adminGetAllUsers, adminToggleUserBlock, adminAdjustUserBalance, adminGetDeposits, adminProcessDeposit, adminGetWithdrawals, adminProcessWithdrawal, adminGetAllGames, adminGetDashboardStats, adminGetSettings, adminUpdateSettings,
};