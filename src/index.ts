import express from 'express'
import http from 'http'
import socketIo from 'socket.io'
import crypto from 'crypto'
import { BSafe, Vault, TransactionStatus } from 'bsafe'
import { IConnectedSocketUser, SocketEvents, SocketUsernames } from './types'
import { IEventTX_REQUEST, IEventTX_CONFIRM, txConfirm, txRequest } from './modules/transactions'
import { DatabaseClass } from './utils/database'

const { PORT, TIMOUT_DICONNECT, APP_NAME, BAKO_URL_API } = process.env

const app = express()
const server = http.createServer(app)
const io = new socketIo.Server(server, {
	cors: {
		origin: '*',
	},
	connectTimeout: Number(TIMOUT_DICONNECT), // 1 hora
})

// Endpoint de teste para o Express
app.get('/', (req, res) => {
	res.status(200)
	res.json({ message: `${APP_NAME} ${new Date()}` })
})

// Configuração do Socket.IO
io.on(SocketEvents.CONNECT, async socket => {
	const { sessionId, username, request_id } = socket.handshake.auth
	await socket.join(`${sessionId}:${username}:${request_id}`)
	/* 
		[UI] emite esse evento quando o usuário confirma a tx 
			- verifica se o evento veio da origem correta -> BAKO-UI [http://localhost:5174, https://safe.bako.global]
			- recupera as infos do dapp que está tentando criar a tx pelo sessionId
			- gera uma credencial temporária (code) para ser usada para criar a tx com o pacote bakosafe
			- usa a sdk da bako safe para instanciar o vault connectado ao dapp
			- cria a tx com a sdk da bako safe, usando o code gerado
			- atualiza o sumary da tx
			- cria uma invalidacao para o code gerado
			- emite uma mensagem para o [CONNECTOR] com o resultado da tx [TX_EVENT_CONFIRMED] ou [TX_EVENT_FAILED]
			- todo: nao muito importante, mas é necessário tipar operations
	*/
	socket.on(SocketEvents.TX_CONFIRM, data => txConfirm({ data, socket }))

	/*
		[CONNECTOR] emite esse evento quando o usuário quer criar uma transação
			- recupera as infos do dapp que está tentando criar a tx pelo sessionId
			- verifica se as informações do dapp estão corretas com as vindas pela mensagem do connector
			- verifica se há transacoes pendentes nesse vault
			- cria um código temporário para ser usado na criação da tx (limite 2 mins)
			- emite uma mensagem para a [UI] com as informações da tx [TX_EVENT_REQUESTED] + o dapp
	 */
	socket.on(SocketEvents.TX_REQUEST, data => txRequest({ data, socket }))

	// Lidar com mensagens recebidas do cliente
	socket.on(SocketEvents.DEFAULT, data => {
		//console.log('Mensagem recebida:', data)
		const { sessionId, to, type, request_id, data: content } = data
		//await socket.join(`${sessionId}:${username}:${request_id}`)
		const room = `${sessionId}:${to}:${request_id}`
		// Enviar mensagem para todos os clientes conectados
		socket.to(room).emit(SocketEvents.DEFAULT, data)
	})

	// Lidar com desconexões de clientes
	//todo: verificar na lista de rooms criadas, quando uma popup é fechada e avisar o [CONNECTOR] para não esperar mais
	// socket.on('disconnect', () => {
	// 	//console.log('Um cliente se desconectou:', socket.handshake.auth)
	// 	const { sessionId, request_id, username } = socket.handshake.auth
	// 	if (username == '[UI]') {
	// 		const room = `${sessionId}:${'[CONNECTOR]'}:${request_id}`
	// 		console.log('[EMMITINDO]: ', room)
	// 		io.to(room).emit('message', {
	// 			username,
	// 			request_id,
	// 			to: '[CONNECTOR]',
	// 			type: '[CLIENT_DISCONNECTED]',
	// 			data: {},
	// 		})
	// 	}
	// })
})

// Iniciar o servidor
const port = PORT || 3000
server.listen(port, () => {
	console.log(`Server runner on port ${port}`)
})
