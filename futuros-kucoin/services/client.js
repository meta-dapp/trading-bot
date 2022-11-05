const Kucoin = require('kucoin-futures-node-api')

const apiKey = process.env.APIKEY
const secretKey = process.env.SECRETKEY
const passphrase = process.env.PASSPHRASE
const environment = process.env.ENVIROMENT

const client = new Kucoin()
client.init({
    apiKey,
    secretKey,
    passphrase,
    environment
})

module.exports = client