const axios = require('axios');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const { transactionId } = JSON.parse(event.body || '{}');
    if (!transactionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Transaction ID é obrigatório.' }) };
    }

    const base = process.env.VIZZION_API_URL || 'https://app.vizzionpay.com/api/v1';
    const statusUrl = `${base}/gateway/pix/status/${transactionId}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Public-Key': process.env.VIZZION_PUBLIC_KEY,
      'X-Secret-Key': process.env.VIZZION_SECRET_KEY
    };

    const response = await axios.get(statusUrl, { headers });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: response.data })
    };
  } catch (error) {
    const details = error.response ? error.response.data : error.message;
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro ao verificar status do pagamento.', details })
    };
  }
};

