// eslint-disable-next-line prettier/prettier
import { Client, type QueryResult } from 'pg'

interface ConnectionConfig {
  user: string
  password: string
  database: string
  host: string
  port: number
}

export const defaultConnection: ConnectionConfig = {
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
  host: '127.0.0.1',
  port: 5432
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
