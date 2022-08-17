const Binance = require('node-binance-api')
const client = new Binance().options({
    APIKEY: process.env.APIKEY,
    APISECRET: process.env.SECRET,
    useServerTime: true
})

module.exports = client