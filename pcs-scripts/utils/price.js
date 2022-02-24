const axios = require('axios')

const TokenPrice = async (tokenContract) => {
    const res = await axios.post(`https://api.dex.guru/v2/tokens/price`, {
        ids: [`${tokenContract}-bsc`]
    })
    const r = res.data;
    if (r.data.length > 0) {
        var def = r.data[0]
        return {
            usd: def.token_price_usd,
            bnb: def.token_price_eth
        }
    }

    return {
        usd: 0,
        bnb: 0
    }
}

module.exports = TokenPrice