const client = require('kucoin-node-api')

const config = {
    apiKey: process.env.APIKEY,
    secretKey: process.env.SECRET,
    passphrase: process.env.PHRASE,
    environment: 'live'
}

client.init(config)

module.exports = client