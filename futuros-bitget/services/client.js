const bitget = require('bitget-openapi')

const apiKey = process.env.APIKEY
const secretKey = process.env.SECRETKEY
const passphrase = process.env.PASSPHRASE

const client = {
    futuresAccount: new bitget.MixAccountApi(apiKey, secretKey, passphrase),
    futuresOrder: new bitget.MixOrderApi(apiKey, secretKey, passphrase),
    futuresPosition: new bitget.MixPlanApi(apiKey, secretKey, passphrase),
    futuresMarket: new bitget.MixMarketApi(apiKey, secretKey, passphrase)
}

module.exports = client