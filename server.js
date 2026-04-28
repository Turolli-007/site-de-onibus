require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const mockData = require('./mockData');

const app = express();
const PORT = process.env.PORT || 3000;
const SPTRANS_TOKEN = process.env.SPTRANS_TOKEN;
const SPTRANS_BASE_URL = 'http://api.olhovivo.sptrans.com.br/v2.1';

// Modo demonstração: ativo quando token é o placeholder ou DEMO=true
const USE_MOCK = !SPTRANS_TOKEN || SPTRANS_TOKEN === 'SEU_TOKEN_AQUI' || process.env.DEMO === 'true';

if (USE_MOCK) {
  console.log('========================================');
  console.log(' MODO DEMONSTRAÇÃO ATIVADO');
  console.log(' Dados simulados em uso (sem API real)');
  console.log('========================================');
} else if (!SPTRANS_TOKEN) {
  console.error('Erro: SPTRANS_TOKEN não configurado. Crie um arquivo .env baseado no .env.example');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let authCookie = null;

async function authenticate() {
  if (USE_MOCK) return true;
  try {
    const response = await axios.post(
      `${SPTRANS_BASE_URL}/login/autenticar?token=${SPTRANS_TOKEN}`,
      {},
      { withCredentials: true }
    );
    if (response.data) {
      authCookie = response.headers['set-cookie'];
      console.log('Autenticado na SPTrans com sucesso');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Erro na autenticação SPTrans:', error.message);
    return false;
  }
}

async function sptransRequest(endpoint, params = {}) {
  if (USE_MOCK) {
    throw new Error('Modo mock não deve chamar sptransRequest diretamente');
  }

  try {
    if (!authCookie) {
      const ok = await authenticate();
      if (!ok) throw new Error('Falha na autenticação');
    }

    const url = new URL(endpoint, SPTRANS_BASE_URL);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });

    const response = await axios.get(url.toString(), {
      headers: { Cookie: authCookie },
      withCredentials: true,
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      authCookie = null;
      const ok = await authenticate();
      if (ok) return sptransRequest(endpoint, params);
    }
    throw error;
  }
}

// ========================================
// Endpoints da API
// ========================================

app.get('/api/linhas', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Parâmetro q é obrigatório' });

    if (USE_MOCK) {
      const results = mockData.searchMockLines(q);
      return res.json(results);
    }

    const data = await sptransRequest('/linha/buscar', { termosBusca: q });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posicao', async (req, res) => {
  try {
    if (USE_MOCK) {
      return res.json({ l: [] });
    }
    const data = await sptransRequest('/posicao');
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/posicao/:codigoLinha', async (req, res) => {
  try {
    const codigoLinha = parseInt(req.params.codigoLinha);

    if (USE_MOCK) {
      const data = mockData.updateVehicles(codigoLinha);
      return res.json(data);
    }

    const data = await sptransRequest('/posicao/linha', { codigoLinha });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/paradas', async (req, res) => {
  try {
    const { termos } = req.query;
    if (!termos) return res.status(400).json({ error: 'Parâmetro termos é obrigatório' });

    if (USE_MOCK) {
      return res.json([]);
    }

    const data = await sptransRequest('/parada/buscar', { termosBusca: termos });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/paradasPorLinha/:codigoLinha', async (req, res) => {
  try {
    const codigoLinha = parseInt(req.params.codigoLinha);

    if (USE_MOCK) {
      const data = mockData.generateMockStops(codigoLinha);
      return res.json(data);
    }

    const data = await sptransRequest('/parada/buscarParadasPorLinha', { codigoLinha });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/previsao/:codigoParada/:codigoLinha', async (req, res) => {
  try {
    const codigoParada = parseInt(req.params.codigoParada);
    const codigoLinha = parseInt(req.params.codigoLinha);

    if (USE_MOCK) {
      const data = mockData.generateMockPrediction(codigoParada, codigoLinha);
      return res.json(data);
    }

    const data = await sptransRequest('/previsao', { codigoParada, codigoLinha });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shape/:codigoLinha', async (req, res) => {
  try {
    const codigoLinha = parseInt(req.params.codigoLinha);

    if (USE_MOCK) {
      const data = mockData.generateMockShapes(codigoLinha);
      return res.json(data);
    }

    const data = await sptransRequest('/shapes', { codigoLinha });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/detalheLinha/:codigoLinha', async (req, res) => {
  try {
    const codigoLinha = parseInt(req.params.codigoLinha);

    if (USE_MOCK) {
      const line = mockData.DEMO_LINES.find(l => l.cl === codigoLinha);
      return res.json(line ? [line] : []);
    }

    const data = await sptransRequest('/linha/carregarDetalhes', { codigoLinha });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  if (!USE_MOCK) {
    await authenticate();
  }
});

