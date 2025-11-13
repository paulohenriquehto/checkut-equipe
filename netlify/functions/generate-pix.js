const axios = require('axios');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const { nome, email, telefone, cpf, amount } = JSON.parse(event.body || '{}');

    if (!nome || !email || !telefone || !cpf || !amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Todos os campos (nome, email, telefone, cpf, valor) são obrigatórios.' })
      };
    }

    const base = process.env.VIZZION_API_URL || 'https://app.vizzionpay.com/api/v1';
    const receiveUrl = base.endsWith('/gateway/pix/receive') ? base : `${base}/gateway/pix/receive`;

    const requestData = {
      identifier: `txid-${Date.now()}`,
      amount: parseFloat(amount),
      client: {
        name: nome,
        email: email,
        phone: String(telefone).replace(/[^0-9]/g, ''),
        document: String(cpf).replace(/[^0-9]/g, '')
      },
      metadata: { description: `Pagamento PIX para ${nome}` }
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Public-Key': process.env.VIZZION_PUBLIC_KEY,
      'X-Secret-Key': process.env.VIZZION_SECRET_KEY
    };

    const response = await axios.post(receiveUrl, requestData, { headers });

    const pixData = response.data && response.data.pix ? response.data.pix : null;

    if (pixData && pixData.base64 && pixData.code) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            qrCodeBase64: pixData.base64,
            qrCodeText: pixData.code,
            transactionId: response.data.transactionId
          }
        })
      };
    }

    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Resposta da API inválida: QR Code não encontrado.', details: response.data })
    };
  } catch (error) {
    const details = error.response ? error.response.data : error.message;
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro ao gerar o PIX. Verifique as chaves de API e os dados enviados.', details })
    };
  }
};

