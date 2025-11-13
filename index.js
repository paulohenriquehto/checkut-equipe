const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3003;

const VIZZION_API_URL = 'https://app.vizzionpay.com/api/v1/gateway/pix/receive';
const VIZZION_PUBLIC_KEY = process.env.VIZZION_PUBLIC_KEY;
const VIZZION_SECRET_KEY = process.env.VIZZION_SECRET_KEY;

// Configurações da Kiwify para Cartão de Crédito
const KIWIFY_CLIENT_ID = process.env.KIWIFY_CLIENT_ID;
const KIWIFY_CLIENT_SECRET = process.env.KIWIFY_CLIENT_SECRET;
const KIWIFY_API_URL = process.env.KIWIFY_API_URL || 'https://public-api.kiwify.com/v1';

// Cache do token OAuth da Kiwify
let kiwifyAccessToken = null;
let kiwifyTokenExpiry = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve arquivos estáticos da raiz do projeto
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/generate-pix', async (req, res) => {
    const { nome, email, telefone, cpf, amount } = req.body;

    if (!nome || !email || !telefone || !cpf || !amount) {
        return res.status(400).json({ error: 'Todos os campos (nome, email, telefone, cpf, valor) são obrigatórios.' });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'O valor deve ser um número positivo.' });
    }

    const requestData = {
        identifier: `txid-${Date.now()}`,
        amount: parseFloat(req.body.amount),
        client: {
            name: nome,
            email: email,
            phone: telefone.replace(/[^0-9]/g, ''),
            document: cpf.replace(/[^0-9]/g, ''),
        },
        metadata: {
            description: `Pagamento PIX para ${nome}`,
        }
    };

    try {
        console.log('📤 Enviando requisição para Vizzion Pay...');
        console.log('📋 Dados enviados:', JSON.stringify(requestData, null, 2));

        const response = await axios.post(VIZZION_API_URL, requestData, {
            headers: {
                'Content-Type': 'application/json',
                'X-Public-Key': VIZZION_PUBLIC_KEY,
                'X-Secret-Key': VIZZION_SECRET_KEY,
            },
        });

        console.log('✅ Resposta recebida da Vizzion Pay:');
        console.log(JSON.stringify(response.data, null, 2));

        const pixData = response.data.pix;

        if (pixData && pixData.base64 && pixData.code) {
            console.log('✅ QR Code encontrado na resposta!');
            res.json({
                data: {
                    qrCodeBase64: pixData.base64,
                    qrCodeText: pixData.code,
                    transactionId: response.data.transactionId,
                }
            });
        } else {
            console.log('❌ QR Code não encontrado na resposta esperada');
            console.log('Estrutura da resposta:', Object.keys(response.data));
            res.status(500).json({ error: 'Resposta da API inválida: QR Code não encontrado.', details: response.data });
        }

    } catch (error) {
        console.error('Erro ao chamar a API Vizzion Pay:', error.response ? error.response.data : error.message);
        res.status(500).json({
            error: 'Erro ao gerar o PIX. Verifique as chaves de API e os dados enviados.',
            details: error.response ? error.response.data : error.message
        });
    }
});

// Endpoint para verificar status do pagamento
app.post('/check-payment', async (req, res) => {
    const { transactionId } = req.body;

    if (!transactionId) {
        return res.status(400).json({ error: 'Transaction ID é obrigatório.' });
    }

    try {
        console.log('🔍 Verificando status do pagamento:', transactionId);

        // Endpoint para verificar status na Vizzion Pay
        const checkUrl = `${VIZZION_API_URL}/gateway/pix/status/${transactionId}`;

        const response = await axios.get(checkUrl, {
            headers: {
                'Content-Type': 'application/json',
                'X-Public-Key': VIZZION_PUBLIC_KEY,
                'X-Secret-Key': VIZZION_SECRET_KEY,
            },
        });

        console.log('✅ Status recebido:', response.data);

        res.json({
            success: true,
            data: response.data
        });

    } catch (error) {
        console.error('Erro ao verificar status:', error.response ? error.response.data : error.message);
        res.status(500).json({
            error: 'Erro ao verificar status do pagamento.',
            details: error.response ? error.response.data : error.message
        });
    }
});

// Função para obter token de acesso da Kiwify
async function getKiwifyAccessToken() {
    // Verifica se o token ainda é válido
    if (kiwifyAccessToken && kiwifyTokenExpiry && Date.now() < kiwifyTokenExpiry) {
        return kiwifyAccessToken;
    }

    try {
        console.log('🔐 Obtendo token de acesso da Kiwify...');

        const response = await axios.post(`${KIWIFY_API_URL}/oauth/token`,
            new URLSearchParams({
                client_id: KIWIFY_CLIENT_ID,
                client_secret: KIWIFY_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        kiwifyAccessToken = response.data.access_token;
        // Token expira em 24 horas (expires_in: 86400) - colocamos margem de 23 horas
        kiwifyTokenExpiry = Date.now() + (23 * 60 * 60 * 1000);

        console.log('✅ Token de acesso obtido com sucesso');
        console.log('⏰ Token válido até:', new Date(kiwifyTokenExpiry).toLocaleString());
        return kiwifyAccessToken;

    } catch (error) {
        console.error('Erro ao obter token Kiwify:', error.response ? error.response.data : error.message);
        throw new Error('Falha na autenticação com Kiwify');
    }
}

// Endpoint para processar pagamento com cartão via Kiwify
app.post('/process-card', async (req, res) => {
    const { nome, email, cpf, telefone, cardNumber, cardName, cardExpiry, cardCvv, amount } = req.body;

    // Validação de campos obrigatórios
    if (!nome || !email || !cpf || !telefone || !amount) {
        return res.status(400).json({ error: 'Dados do cliente são obrigatórios.' });
    }

    if (!cardNumber || !cardName || !cardExpiry || !cardCvv) {
        return res.status(400).json({ error: 'Dados do cartão são obrigatórios.' });
    }

    try {
        console.log('💳 Processando pagamento com cartão via Kiwify...');

        // Obter token de acesso
        const accessToken = await getKiwifyAccessToken();

        // Preparar dados do pagamento
        const paymentData = {
            amount: parseFloat(amount),
            customer: {
                name: nome,
                email: email,
                document: cpf.replace(/\D/g, ''),
                phone: telefone.replace(/\D/g, '')
            },
            card: {
                number: cardNumber.replace(/\D/g, ''),
                holder_name: cardName,
                exp_month: cardExpiry.substring(0, 2),
                exp_year: '20' + cardExpiry.substring(3, 5),
                cvv: cardCvv
            },
            installments: 1,
            description: 'Truque do Sal Rosa'
        };

        console.log('📤 Enviando dados para Kiwify...');

        // Fazer requisição para API da Kiwify
        const response = await axios.post(`${KIWIFY_API_URL}/payments`, paymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        console.log('✅ Resposta da Kiwify:', response.data);

        res.json({
            success: true,
            data: response.data
        });

    } catch (error) {
        console.error('Erro ao processar pagamento Kiwify:', error.response ? error.response.data : error.message);
        res.status(500).json({
            error: 'Erro ao processar pagamento com cartão.',
            details: error.response ? error.response.data : error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
