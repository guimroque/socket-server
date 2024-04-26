// eslint-disable-next-line prettier/prettier
import { Client, type QueryResult } from 'pg'

const {
  DB_USER,
  DB_PASSWORD,
  DB_DATABASE,
  DB_HOST,
  DB_PORT
} = process.env

interface ConnectionConfig {
  user: string
  password: string
  database: string
  host: string
  port: number
}

export const defaultConnection: ConnectionConfig = {
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_DATABASE,
  host: DB_HOST,
  port: Number(DB_PORT)
}

export class DatabaseClass {
  private readonly client: Client
  protected constructor (client: Client) {
    this.client = client
  }

  static async connect (connection: ConnectionConfig = defaultConnection): Promise<DatabaseClass> {
    const cl = new Client(connection)
    await cl.connect()
    return new DatabaseClass(cl)
  }

  async query (query: string): Promise<any> {
    try {
      // console.log('[query_called]')
      const { rows }: QueryResult = await this.client.query(query)
      // console.log('Query executada com sucesso:', query, rows)
      if (rows.length === 1) return rows[0]
      return rows
    } catch (error) {
      console.error('Erro ao executar a query:', error)
      throw error
    }
  }
}
