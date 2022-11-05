require('dotenv').config()
const client = require('./services/client')
const { v4: uuidv4 } = require('uuid');

var PAIR1 = process.argv[2] || 'BTC'
PAIR1 = PAIR1.replace('BTC', 'XBT')
const PAIR2 = process.argv[3] || 'USDT'
const AMOUNT = process.argv[4] || 15
const LEVERAGE = process.argv[5] || 5
const TAKE_PROFIT_PERCENT = process.argv[6] || 0.3
const STOP_LOSS_PERCENT = process.argv[7] || 1

const sleep = (timeMs) => new Promise(resolve => setTimeout(resolve, timeMs))

async function placeLongPosition() {
    const contracts = await client.getAllContracts()
    const contract = contracts.data.find(contract => contract.baseCurrency === PAIR1 &&
        contract.quoteCurrency === PAIR2)

    var { price, pricePlace, lotSize, multiplier } = {
        price: contract.markPrice,
        pricePlace: contract.markPrice.toString().includes('.')
            ? contract.markPrice.toString().split('.')[1].length : 0,
        lotSize: contract.lotSize,
        tickSize: contract.indexPriceTickSize,
        multiple: contract.tickSize,
        multiplier: contract.multiplier
    }

    const amountBuyPAIR2 = AMOUNT * LEVERAGE

    const amountBuyPAIR1 = parseFloat(amountBuyPAIR2) / parseFloat(price)

    const size = parseInt((lotSize * amountBuyPAIR1) / multiplier)
    const BuyOrder = await client.placeOrder({
        clientOid: uuidv4(),
        symbol: contract.symbol,
        side: 'buy',
        type: 'market',
        leverage: LEVERAGE,
        size,
    })

    if ('data' in BuyOrder && 'orderId' in BuyOrder.data) {
        var order = await client.getOrderById({ oid: BuyOrder.data.orderId })
        const buyPrice = parseFloat((order.data.filledValue / order.data.filledSize)
            / multiplier).toFixed(pricePlace)

        var tp = parseFloat(parseFloat(buyPrice)
            + (parseFloat(buyPrice) * TAKE_PROFIT_PERCENT / 100)).toFixed(pricePlace)

        var sl = parseFloat(parseFloat(buyPrice)
            - (parseFloat(buyPrice) * STOP_LOSS_PERCENT / 100)).toFixed(pricePlace)

        client.initSocket({ topic: "advancedOrders", symbols: [`${PAIR1}-${PAIR2}`] }, (msg) => {
            const res = JSON.parse(msg)
            if ('data' in res) {
                const order = res.data
                console.log(order.orderId, ': ', order.stop, order.type)
                if (order.type === 'triggered') {
                    checkOrdersStatus()
                } else if (order.type === 'cancel') {
                    process.exit()
                }
            }
        })

        await sleep(1000)

        await client.placeOrder({
            clientOid: uuidv4(),
            symbol: contract.symbol,
            side: 'sell',
            stop: 'up',
            stopPrice: tp,
            stopPriceType: 'MP',
            leverage: LEVERAGE,
            type: 'market',
            size,
            closeOrder: true,
        })

        await client.placeOrder({
            clientOid: uuidv4(),
            symbol: contract.symbol,
            side: 'sell',
            stop: 'down',
            stopPrice: sl,
            stopPriceType: 'MP',
            leverage: LEVERAGE,
            type: 'market',
            size,
            closeOrder: true,
        })
    } else {
        console.log('¡Order not executed!')
    }
}

const checkOrdersStatus = async (attemps = 0) => {
    await sleep(4000)
    const orders = await client.getStopOrders()
    try {
        if (orders.data.items.length == 1) {
            const id = orders.data.items[0].id
            const order = await client.cancelOrder({ id })
            if (order.data.cancelledOrderIds.includes(id))
                return
        } else if (orders.data.items.length == 0)
            return
    } catch (err) {
        if (attemps < 5)
            return checkOrdersStatus(++attemps)
    }
}

placeLongPosition()