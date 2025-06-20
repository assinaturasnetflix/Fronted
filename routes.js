// routes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');

// Importaremos toda a lógica e os middlewares do nosso futuro arquivo `controllers.js`
const {
    // Middlewares de Autenticação e Autorização
    protect,
    admin,

    // Controladores de Autenticação e Usuário
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    uploadAvatar,
    getPublicProfile,
    getRanking,

    // Controladores de Lobby e Jogo
    createLobbyRoom,
    getPublicLobbies,
    findPrivateLobbyByCode,
    getGameHistory,
    getGameDetails,
    getActiveGameNotification,

    // Controladores de Transações
    requestDeposit,
    requestWithdrawal,
    getTransactionHistory,
    getPaymentInstructions,

    // Controladores de Admin
    adminGetAllUsers,
    adminToggleUserBlock,
    adminAdjustUserBalance,
    adminGetDeposits,
    adminProcessDeposit,
    adminGetWithdrawals,
    adminProcessWithdrawal,
    adminGetAllGames,
    adminGetDashboardStats,
    adminGetSettings,
    adminUpdateSettings,
} = require('./controllers.js');

// --- Configuração do Multer para Upload de Avatar ---
// Armazena o arquivo na memória para que o controlador possa enviá-lo para o Cloudinary
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // Limite de 2MB
    fileFilter: (req, file, cb) => {
        // Aceita apenas imagens
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb({ message: 'Apenas ficheiros de imagem são permitidos (jpg, png, etc.)' }, false);
        }
    },
});

/*
|--------------------------------------------------------------------------
| ROTAS PÚBLICAS (NÃO REQUEREM AUTENTICAÇÃO)
|--------------------------------------------------------------------------
*/
// @desc    Registrar um novo usuário
// @route   POST /api/auth/register
router.post('/auth/register', registerUser);

// @desc    Autenticar usuário e obter token
// @route   POST /api/auth/login
router.post('/auth/login', loginUser);

// @desc    Solicitar código de recuperação de senha
// @route   POST /api/auth/forgot-password
router.post('/auth/forgot-password', forgotPassword);

// @desc    Redefinir senha com o código
// @route   POST /api/auth/reset-password
router.post('/auth/reset-password', resetPassword);

// @desc    Ver perfil público de um jogador
// @route   GET /api/users/profile/:username
router.get('/users/profile/:username', getPublicProfile);

// @desc    Obter o ranking de jogadores
// @route   GET /api/users/ranking
router.get('/users/ranking', getRanking);

// @desc    Obter as instruções e números para depósito
// @route   GET /api/settings/payment-info
router.get('/settings/payment-info', getPaymentInstructions);


/*
|--------------------------------------------------------------------------
| ROTAS PROTEGIDAS (REQUEREM AUTENTICAÇÃO DE USUÁRIO)
|--------------------------------------------------------------------------
*/
// @desc    Obter e atualizar o perfil do usuário logado
// @route   GET, PUT /api/users/me
router.route('/users/me')
    .get(protect, getUserProfile)
    .put(protect, updateUserProfile);

// @desc    Fazer upload do avatar do usuário
// @route   PUT /api/users/me/avatar
router.put('/users/me/avatar', protect, upload.single('avatar'), uploadAvatar);

// @desc    Listar salas de apostas públicas no lobby
// @route   GET /api/lobby
router.get('/lobby', protect, getPublicLobbies);

// @desc    Criar uma nova sala de aposta (pública ou privada)
// @route   POST /api/lobby/create
router.post('/lobby/create', protect, createLobbyRoom);

// @desc    Encontrar uma sala privada pelo código
// @route   GET /api/lobby/private/:code
router.get('/lobby/private/:code', protect, findPrivateLobbyByCode);

// @desc    Obter o histórico de partidas do usuário
// @route   GET /api/games/history
router.get('/games/history', protect, getGameHistory);

// @desc    Obter detalhes de uma partida específica
// @route   GET /api/games/:id
router.get('/games/:id', protect, getGameDetails);

// @desc    Verificar se há notificações de partidas ativas
// @route   GET /api/games/notification/active
router.get('/games/notification/active', protect, getActiveGameNotification);

// @desc    Solicitar um novo depósito
// @route   POST /api/transactions/deposit
router.post('/transactions/deposit', protect, requestDeposit);

// @desc    Solicitar um novo levantamento
// @route   POST /api/transactions/withdraw
router.post('/transactions/withdraw', protect, requestWithdrawal);

// @desc    Obter o histórico de transações do usuário
// @route   GET /api/transactions/history
router.get('/transactions/history', protect, getTransactionHistory);


/*
|--------------------------------------------------------------------------
| ROTAS DE ADMIN (REQUEREM AUTENTICAÇÃO E PERMISSÃO DE ADMIN)
|--------------------------------------------------------------------------
*/
const adminRouter = express.Router();

// Gestão de Usuários
adminRouter.get('/users', adminGetAllUsers);
adminRouter.put('/users/:id/toggle-block', adminToggleUserBlock);
adminRouter.post('/users/:id/adjust-balance', adminAdjustUserBalance);

// Gestão de Transações
adminRouter.get('/deposits', adminGetDeposits);
adminRouter.put('/deposits/:id/process', adminProcessDeposit);
adminRouter.get('/withdrawals', adminGetWithdrawals);
adminRouter.put('/withdrawals/:id/process', adminProcessWithdrawal);

// Gestão do Sistema e Jogos
adminRouter.get('/games', adminGetAllGames);
adminRouter.get('/dashboard-stats', adminGetDashboardStats);

// Gestão de Configurações
adminRouter.route('/settings')
    .get(adminGetSettings)
    .put(adminUpdateSettings);

// Aplicar o prefixo /api/admin e os middlewares de proteção em todas as rotas de admin
router.use('/admin', protect, admin, adminRouter);


module.exports = router;