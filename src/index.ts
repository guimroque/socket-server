import express from 'express'
import http from 'http'
import socketIo from 'socket.io'
import crypto from 'crypto'
import { BSafe, Vault, TransactionStatus } from 'bsafe'

import { DatabaseClass } from './utils/database'
import { TransactionRequestLike } from 'fuels'

const app = express()
const server = http.createServer(app)
const io = new socketIo.Server(server, {
	cors: {
		origin: '*',
	},
	connectTimeout: 1000 * 60 * 60, // 1 hora
})

// Endpoint de teste para o Express
app.get('/', (req, res) => {
	res.send('Servidor Express está funcionando!')
})

interface IConnectedSocketUser {
	id: string
	sessionId: string
	username: string
	request_id: string
	time: number
}

const connected_users: IConnectedSocketUser[] = []

// Configuração do Socket.IO
io.on('connection', async socket => {
	const { sessionId, username, request_id } = socket.handshake.auth
	await socket.join(`${sessionId}:${username}:${request_id}`)
	connected_users.push({ id: socket.id, sessionId, username, request_id, time: new Date().getTime() })
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
	*/ socket.on(
		'[TX_EVENT_CONFIRM]',
		async ({ tx, operations }: { tx: TransactionRequestLike; operations: any }) => {
			const room = `${sessionId}:[CONNECTOR]:${request_id}`
			const { origin, host } = socket.handshake.headers
			const { auth } = socket.handshake
			try {
				// ------------------------------ [VALIDACOES] ------------------------------

				console.log('[TX_EVENT_CONFIRM]', socket.handshake.headers)
				// validar se o origin é diferente da url usada no front...adicionar um .env pra isso
				if (origin !== 'http://localhost:5174') return
				const database = await DatabaseClass.connect()

				// ------------------------------ [VALIDACOES] ------------------------------

				// ------------------------------ [DAPP] ------------------------------
				const dapp = await database.query(`
				SELECT d.*, u.id AS user_id, u.address AS user_address, c.id AS current_vault_id
				FROM dapp d
				JOIN "users" u ON d.user = u.id
				JOIN "predicates" c ON d.current = c.id
				WHERE d.session_id = '${auth.sessionId}'  
			`)
				// console.log('[DAPP]: ', dapp)
				if (!dapp) return
				// ------------------------------ [CODE] ------------------------------
				const code = await database.query(`
				SELECT *
				FROM recover_codes
				WHERE origin = '${host}' 
				AND owner = '${dapp.user_id}'
				AND used = false
				AND valid_at > NOW()
				ORDER BY valid_at DESC
				LIMIT 1;
			`)
				if (!code) return
				// console.log('[CODE]', code)
				// ------------------------------ [CODE] ------------------------------

				// ------------------------------ [TX] ------------------------------
				// console.log('[chamando predicate]', dapp.current_vault_id, dapp.user_address, code.code)
				BSafe.setup({
					API_URL: 'http://localhost:3333',
				})
				const predicate = await Vault.create({
					id: dapp.current_vault_id,
					address: dapp.user_address,
					token: code.code,
				})
				const _tx = await predicate.BSAFEIncludeTransaction(tx)
				// ------------------------------ [TX] ------------------------------

				// ------------------------------ [SUMMARY] ------------------------------
				await database.query(`
				UPDATE transactions
				SET summary = '${JSON.stringify({
					operations: operations.operations,
					name: dapp.name,
					origin: dapp.origin,
				})}'
				WHERE id = '${_tx.BSAFETransactionId}'
			`)
				// ------------------------------ [SUMMARY] ------------------------------

				// ------------------------------ [INVALIDATION] ------------------------------
				await database.query(`
				DELETE FROM recover_codes
				WHERE id = '${code.id}'
			`)
				// ------------------------------ [INVALIDATION] ------------------------------

				// ------------------------------ [EMIT] ------------------------------
				socket.to(room).emit('message', {
					username,
					room: sessionId,
					to: '[CONNECTOR]',
					type: '[TX_EVENT_CONFIRMED]',
					data: {
						id: _tx.getHashTxId(),
						status: '[SUCCESS]',
					},
				})
				// ------------------------------ [EMIT] ------------------------------
			} catch (e) {
				socket.to(room).emit('message', {
					username,
					room: sessionId,
					to: '[CONNECTOR]',
					type: '[TX_EVENT_CONFIRMED]',
					data: {
						id: undefined,
						status: '[SUCCESS]',
					},
				})
			}
		},
	)

	/*
		[CONNECTOR] emite esse evento quando o usuário quer criar uma transação
			- recupera as infos do dapp que está tentando criar a tx pelo sessionId
			- verifica se as informações do dapp estão corretas com as vindas pela mensagem do connector
			- verifica se há transacoes pendentes nesse vault
			- cria um código temporário para ser usado na criação da tx (limite 2 mins)
			- emite uma mensagem para a [UI] com as informações da tx [TX_EVENT_REQUESTED] + o dapp
	 */
	socket.on('[TX_EVENT_REQUEST]', async ({ _transaction, _address }: { _transaction: TransactionRequestLike; _address: string }) => {
		try {
			const { origin, host } = socket.handshake.headers
			const { auth } = socket.handshake
			// console.log(socket.handshake.headers)
			const database = await DatabaseClass.connect()
			//console.log('[TX_EVENT_REQUEST]', socket.handshake.headers)

			const dapp = await database.query(`
				SELECT d.*, u.id AS user_id,
				u.address AS user_address,
				c.id AS current_vault_id, 
				c.name AS current_vault_name, 
				c.description AS current_vault_description, 
				c.provider AS current_vault_provider
				FROM dapp d
				JOIN "users" u ON d.user = u.id
				JOIN "predicates" c ON d.current = c.id
				WHERE d.session_id = '${auth.sessionId}'  
			`)
			const isValid = dapp && dapp.origin === origin

			//todo: adicionar emissao de erro
			if (!isValid) return

			const vault = await database.query(`
				SELECT * from predicates
				WHERE id = '${dapp.current_vault_id}'
			`)

			if (!vault) return

			const code = await database.query(`
				INSERT INTO recover_codes (origin, owner, type, code, valid_at, metadata, used)
				VALUES ('${host}', '${dapp.user_id}', 'AUTH_ONCE', 'code${crypto.randomUUID()}',
				NOW() + INTERVAL '2 minutes', '${JSON.stringify({ uses: 0 })}', false)
				RETURNING *;
			`)

			const tx_pending = await database.query(`
				SELECT COUNT(*)
				FROM transactions t
				WHERE t.predicate_id = '${vault.id}' 
				AND t.status = '${TransactionStatus.AWAIT_REQUIREMENTS}'
				AND t.deleted_at IS NULL;
			`)
			//console.log('[TX_PENDING]', tx_pending, Number(tx_pending.count) > 0)

			const room = `${sessionId}:[UI]:${request_id}`
			console.log('[TUDO OK POR AQUI, ENVIANDO AO FRONT]: ', room)
			socket.to(room).emit('message', {
				username,
				room: sessionId,
				to: '[UI]',
				type: '[TX_EVENT_REQUESTED]',
				data: {
					dapp: {
						name: dapp.name,
						description: dapp.description,
						origin: dapp.origin,
					},
					vault: {
						name: dapp.current_vault_name,
						description: dapp.current_vault_description,
						address: vault.predicateAddress,
						provider: dapp.current_vault_provider,
						pending_tx: Number(tx_pending.count) > 0,
					},
					tx: _transaction,
					validAt: code.valid_at,
				},
			})
		} catch (e) {
			console.log(e)
		}
	})

	// Lidar com mensagens recebidas do cliente
	socket.on('message', data => {
		//console.log('Mensagem recebida:', data)
		const { sessionId, to, type, request_id, data: content } = data
		//await socket.join(`${sessionId}:${username}:${request_id}`)
		const room = `${sessionId}:${to}:${request_id}`
		// Enviar mensagem para todos os clientes conectados
		//console.log('message', data)
		socket.to(room).emit('message', data)
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
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
	console.log(`Servidor iniciado na porta ${PORT}`)
})

/**
 * [REQUEST]
 * - o evento é recebido pelo [SERVIDOR]
 * 		- armazena em uma fila
 * 		- repassa a mensagem para o destino
 * 		- inicia contagem de timeout
 * 			- caso o timeout acabe:
 * 				- emite um evento de erro para o solicitante
 * 				- remove da fila
 * 				- desconecta solicitante
 * 		- caso o evento de confirmação seja emitido:
 * 			- remove da fila
 * 			- emite a confirmação para o solicitante
 *			- desconecta solicitante
 *
 *
 * [RESPONSE]
 * - o evento é recebido pelo [SERVIDOR]
 * 		- verifica na fila quem é o solicitante
 * 		- emite o evento de confirmação para o solicitante
 * 		- remove da fila
 * 		- desconecta solicitante
 * 		- desconecta o emissor da resposta
 */
