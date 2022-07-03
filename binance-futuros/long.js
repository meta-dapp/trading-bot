require('dotenv').config()
const client = require('./services/client')

const PAIR1 = process.argv[2] || 'BTC'
const PAIR2 = process.argv[3] || 'USDT'
const AMOUNT = process.argv[4] || 15
const LEVERAGE = process.argv[5] || 5
const TAKE_PROFIT_PERCENT = process.argv[6] || 0.2
const STOP_LOSS_PERCENT = process.argv[7] || 1

async function placeLongPosition() {
    const market = `${PAIR1}${PAIR2}`
    const balance = (await client.futuresBalance()).filter(item => {
        return item.asset === PAIR2
    })[0].availableBalance

    const amountBuyPAIR2 = AMOUNT * LEVERAGE
    await client.futuresLeverage(market, LEVERAGE)
    const price = (await client.futuresMarkPrice(market)).markPrice
    const amountBuyPAIR1 = parseFloat(amountBuyPAIR2) / parseFloat(price)

    if (balance >= amountBuyPAIR2 / LEVERAGE) {
        var orders = [{
            symbol: market,
            side: "BUY",
            type: "LIMIT",
            price: parseFloat(price).toFixed(0),
            positionSide: 'BOTH',
            reduceOnly: 'false',
            timeInForce: 'GTC',
            quantity: parseFloat(amountBuyPAIR1).toFixed(3)
        }]

        var result = await client.futuresMultipleOrders(orders)
        console.log(result)
        orders = [{
                symbol: market,
                side: "SELL",
                type: "TAKE_PROFIT_MARKET",
                priceProtect: 'true',
                reduceOnly: 'true',
                workingType: 'MARK_PRICE',
                timeInForce: 'GTE_GTC',
                stopPrice: parseFloat(parseFloat(price) + (parseFloat(price) * TAKE_PROFIT_PERCENT / 100)).toFixed(0),
                quantity: parseFloat(amountBuyPAIR1).toFixed(3),
                closePossition: 'true'
            },
            {
                symbol: market,
                side: "SELL",
                type: "STOP_MARKET",
                priceProtect: 'true',
                reduceOnly: 'true',
                workingType: 'MARK_PRICE',
                timeInForce: 'GTE_GTC',
                stopPrice: parseFloat(parseFloat(price) - (parseFloat(price) * STOP_LOSS_PERCENT / 100)).toFixed(0),
                quantity: parseFloat(amountBuyPAIR1).toFixed(3),
                closePossition: 'true'
            }
        ]
        result = await client.futuresMultipleOrders(orders)
        console.log(result)
    }
}

placeLongPosition()