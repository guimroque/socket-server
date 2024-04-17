const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const DatabaseClass = require('./database');
const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
    cors: {
        origin: '*',
    }
})
const crypto = require('crypto')
const {Vault} = require('bakosafe')

// Endpoint de teste para o Express
app.get('/', (req, res) => {
  res.send('Servidor Express está funcionando!');
});

// Configuração do Socket.IO
io.on('connection', async (socket) => {
  console.log('Endereço IP do cliente:', socket.handshake.auth)
    const {sessionId, username} = socket.handshake.auth
    await socket.join(sessionId)
    
    socket.to(sessionId).emit('message', {
        username: username,
        data: {
            room: sessionId,
            to: '[CONNECTOR]',
            type: `[CONNECTED_RESOURCE]`,
            data: {
                username: username
            }
        }
    })


  // evento específico para criar uma nova tx
  socket.on('[TX_EVENT]', async (data) => {

    // ------------------------------ [VALIDACOES] ------------------------------
    const { origin, host } = socket.handshake.headers
    const { auth } = socket.handshake
    console.log(socket.handshake.headers)
    // validar se o origin é diferente da url usada no front...adicionar um .env pra isso
    if (origin !== 'http://localhost:5174') return;
    const database = new DatabaseClass()
    // ------------------------------ [VALIDACOES] ------------------------------

    // ------------------------------ [DAPP] ------------------------------
    //cadastra um novo código de autenticacao
    const dapp = await database.query(`
      SELECT d.*, u.id AS user_id, u.address AS user_address, c.id AS current_vault_id
      FROM dapp d
      JOIN "users" u ON d.user = u.id
      JOIN "predicates" c ON d.current = c.id
      WHERE d.session_id = '${auth.sessionId}'  
    `)
    console.log('[DAPP]: ', dapp)
    if (!dapp) return;
    // ------------------------------ [CODE] ------------------------------
    const code = await database.query(`
      INSERT INTO recover_codes (origin, owner, type, code, valid_at, metadata, used)
      VALUES ('${host}', '${dapp.user_id}', 'AUTH_ONCE', 'code${crypto.randomUUID()}',
      NOW() + INTERVAL '2 minutes', '${JSON.stringify({uses:0})}', false)
      RETURNING *;
    `)
    console.log('[CODE]: ', code)
    if (!code) return;
    // ------------------------------ [CODE] ------------------------------

    // ------------------------------ [TX] ------------------------------
    const predicate = await Vault.create({
      predicateAddress: dapp.current_vault_id,
      address: dapp.user_address,
      token: code.code,
    })
    console.log('[TX] predicate: ', predicate)
    const tx = await predicate.BakoSafeIncludeTransaction(tx)
    console.log('[TX] tx: ', tx)
    // ------------------------------ [TX] ------------------------------



  })

  // Lidar com mensagens recebidas do cliente
  socket.on('message', (data) => {
    // console.log('Mensagem recebida:', data);
    
    // Enviar mensagem para todos os clientes conectados
    socket.to(sessionId).emit('message', {
        username: username,
        data
    })
  });

  // Lidar com desconexões de clientes
  socket.on('disconnect', () => {
    console.log('Um cliente se desconectou');
  });
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
