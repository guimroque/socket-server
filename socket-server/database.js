const { Client } = require('pg');



const default_connection = {
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
    host: '127.0.0.1',
    port: 5432,
}


class DatabaseClass extends Client {
    constructor(connection = default_connection) {
        super(connection);
        this.connect();
    }

    async query(query) {
        try {
            const { rows } = await super.query(query);
            console.log('Query executada com sucesso:', query, rows)
            if(rows.length === 1) return rows[0];
            return rows;
        } catch (error) {
            console.error('Erro ao executar a query:', error);
            throw error;
        }
    }
}

module.exports = DatabaseClass;
