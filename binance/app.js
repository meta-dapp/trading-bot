require('dotenv').config()
const Storage = require('node-storage')
const { log, logColor, colors } = require('./utils/logger')
const client = require('./services/binance')

const MARKET1 = process.argv[2]
const MARKET2 = process.argv[3]
const MARKET = MARKET1 + MARKET2
const BUY_ORDER_AMOUNT = process.argv[4]

const store = new Storage(`./data/${MARKET}.json`)

const sleep = (timeMs) => new Promise(resolve => setTimeout(resolve, timeMs))

async function _balances() {
    return await client.balance()
}

async function _buy(price, amount) {
    if (parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`)) >= BUY_ORDER_AMOUNT * price) {
        var orders = store.get('orders')
        var factor = process.env.PRICE_PERCENT * price / 100

        const order = {
            buy_price: price,
            amount,
            sell_price: price + factor,
            sold_price: 0,
            status: 'pending',
            profit: 0,
        }

        log(`
          Buying ${MARKET1}
          =================
          amountIn: ${parseFloat(BUY_ORDER_AMOUNT * price).toFixed(2)} ${MARKET2}
          amountOut: ${BUY_ORDER_AMOUNT} ${MARKET1}
        `)
        const res = await client.marketBuy(MARKET, order.amount)

        if (res && res.status === 'FILLED') {
            order.status = 'bought'
            order.id = res.orderId
            order.buy_price = parseFloat(res.fills[0].price)

            orders.push(order)
            store.put('start_price', order.buy_price)
            await _updateBalances()

            logColor(colors.green, '=============================')
            logColor(colors.green, `Bought ${BUY_ORDER_AMOUNT} ${MARKET1} for ${parseFloat(BUY_ORDER_AMOUNT * price).toFixed(2)} ${MARKET2}, Price: ${order.buy_price}\n`)
            logColor(colors.green, '=============================')

            await _calculateProfits()
        } else newPriceReset(2, BUY_ORDER_AMOUNT * price, price)
    } else newPriceReset(2, BUY_ORDER_AMOUNT * price, price)
}

function newPriceReset(_market, balance, price) {
    const market = _market == 1 ? MARKET1 : MARKET2
    if (!(parseFloat(store.get(`${market.toLowerCase()}_balance`)) > balance)) {
        store.put('start_price', price)
    }
}

async function _sell(price) {
    const orders = store.get('orders')
    const toSold = []

    for (var i = 0; i < orders.length; i++) {
        var order = orders[i]
        if (price >= order.sell_price) {
            order.sold_price = price
            order.status = 'selling'
            toSold.push(order)
        }
    }

    if (toSold.length > 0) {
        const totalAmount = parseFloat(toSold.map(order => order.amount).reduce((prev, next) => parseFloat(prev) + parseFloat(next)))
        if (totalAmount > 0 && parseFloat(store.get(`${MARKET1.toLowerCase()}_balance`)) >= totalAmount) {
            log(`
                Selling ${MARKET1}
                =================
                amountIn: ${totalAmount.toFixed(2)} ${MARKET1}
                amountOut: ${parseFloat(totalAmount * price).toFixed(2)} ${MARKET2}
            `)
            const res = await client.marketSell(MARKET, totalAmount)
            if (res && res.status === 'FILLED') {
                const _price = parseFloat(res.fills[0].price)

                for (var i = 0; i < orders.length; i++) {
                    var order = orders[i]
                    for (var j = 0; j < toSold.length; j++)
                        if (order.id == toSold[j].id) {
                            toSold[j].profit = (parseFloat(toSold[j].amount) * _price)
                                - (parseFloat(toSold[j].amount) * parseFloat(toSold[j].buy_price))
                            toSold[j].status = 'sold'
                            orders[i] = toSold[j]
                        }
                }

                store.put('start_price', _price)
                await _updateBalances()

                logColor(colors.red, '=============================')
                log(colors.red,
                    `Sold ${totalAmount} ${MARKET1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${MARKET2}, Price: ${_price}\n`)
                log(colors.red, '=============================')

                await _calculateProfits()

                var i = orders.length
                while (i--)
                    if (orders[i].status === 'sold')
                        orders.splice(i, 1)
            } else store.put('start_price', price)
        } else store.put('start_price', price)
    } else store.put('start_price', price)
}

function _logProfits(price) {
    const profits = parseFloat(store.get('profits'))
    var isGainerProfit = profits > 0 ?
        1 : profits < 0 ? 2 : 0

    logColor(isGainerProfit == 1 ?
        colors.green : isGainerProfit == 2 ?
            colors.red : colors.gray,
        `Global Profits: ${parseFloat(store.get('profits')).toFixed(3)} ${MARKET2}`)

    const m1Balance = parseFloat(store.get(`${MARKET1.toLowerCase()}_balance`))
    const m2Balance = parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`))
    const initialBalance = parseFloat(store.get(`initial_${MARKET2.toLowerCase()}_balance`))
    logColor(colors.gray,
        `Balance: ${m1Balance} ${MARKET1}, ${m2Balance.toFixed(2)} ${MARKET2}, Current: ${parseFloat(m1Balance * price + m2Balance).toFixed(2)} ${MARKET2}, Initial: ${initialBalance.toFixed(2)} ${MARKET2}`)
}

async function _calculateProfits() {
    const orders = store.get('orders')
    const sold = orders.filter(order => {
        return order.status === 'sold'
    })

    const totalSoldProfits = sold.length > 0 ?
        sold.map(order => order.profit).reduce((prev, next) =>
            parseFloat(prev) + parseFloat(next)) : 0
    store.put('profits', totalSoldProfits + parseFloat(store.get('profits')))
}

async function _updateBalances() {
    const balances = await _balances()
    store.put(`${MARKET1.toLowerCase()}_balance`, parseFloat(balances[MARKET1].available))
    store.put(`${MARKET2.toLowerCase()}_balance`, parseFloat(balances[MARKET2].available))
}

async function broadcast() {
    while (true) {
        try {
            const mPrice = parseFloat((await client.prices(MARKET))[MARKET])
            if (mPrice) {
                const startPrice = store.get('start_price')
                const marketPrice = mPrice
                console.clear()
                log('==========================================================================================')
                _logProfits(marketPrice)
                log('==========================================================================================')

                log(`Prev price: ${startPrice}`)
                log(`New price: ${marketPrice}`)

                if (marketPrice > startPrice) {
                    var factor = (marketPrice - startPrice)
                    var percent = 100 * factor / marketPrice

                    logColor(colors.green, `Gainers: +${parseFloat(percent).toFixed(3)}% ==> +$${parseFloat(factor).toFixed(4)}`)
                    store.put('percent', `+${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT)
                        await _sell(marketPrice)

                } else if (marketPrice < startPrice) {
                    var factor = (startPrice - marketPrice)
                    var percent = 100 * factor / startPrice

                    logColor(colors.red, `Losers: -${parseFloat(percent).toFixed(3)}% ==> -$${parseFloat(factor).toFixed(4)}`)
                    store.put('percent', `-${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.PRICE_PERCENT)
                        await _buy(marketPrice, BUY_ORDER_AMOUNT)
                } else {
                    logColor(colors.gray, 'Change: 0.000% ==> $0.000')
                    store.put('percent', `0.000`)
                }

                log('==========================================================================================')
            }
        } catch (e) { }
        await sleep(process.env.SLEEP_TIME)
    }
}

async function init() {
    if (process.argv[5] !== 'resume') {
        const price = await client.prices(MARKET)
        store.put('start_price', parseFloat(price[MARKET]))
        store.put('orders', [])
        store.put('profits', 0)
        const balances = await _balances()
        store.put(`${MARKET1.toLowerCase()}_balance`, parseFloat(balances[MARKET1].available))
        store.put(`${MARKET2.toLowerCase()}_balance`, parseFloat(balances[MARKET2].available))
        store.put(`initial_${MARKET1.toLowerCase()}_balance`, store.get(`${MARKET1.toLowerCase()}_balance`))
        store.put(`initial_${MARKET2.toLowerCase()}_balance`, store.get(`${MARKET2.toLowerCase()}_balance`))
    }

    broadcast()
}

init()