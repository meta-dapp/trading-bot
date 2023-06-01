require('dotenv').config()
const Storage = require('node-storage')
const fs = require('fs')
const moment = require('moment')
const { log, logColor, colors } = require('./utils/logger')
const client = require('./services/binance')
const { NotifyTelegram } = require('./services/TelegramNotify')

const MARKET1 = process.argv[2]
const MARKET2 = process.argv[3]
const MARKET = MARKET1 + MARKET2
const BUY_ORDER_AMOUNT = process.argv[4]

const store = new Storage(`./data/${MARKET}.json`)
const sleep = (timeMs) => new Promise(resolve => setTimeout(resolve, timeMs))

function elapsedTime() {
    const diff = Date.now() - store.get('start_time')
    var diffDays = diff / 86400000
    diffDays = diffDays < 1 ? '' : diffDays
    return diffDays + '' + moment.utc(diff).format('HH:mm:ss')
}

function _newPriceReset(_market, balance, price) {
    const market = _market == 1 ? MARKET1 : MARKET2
    if (!(parseFloat(store.get(`${market.toLowerCase()}_balance`)) > balance))
        store.put('start_price', price)
}

async function _updateBalances() {
    const balances = await getBalances()
    store.put(`${MARKET1.toLowerCase()}_balance`, balances[MARKET1])
    store.put(`${MARKET2.toLowerCase()}_balance`, balances[MARKET2])
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

function getRealProfits(price) {
    const m1Balance = parseFloat(store.get(`${MARKET1.toLowerCase()}_balance`))
    const m2Balance = parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`))

    const initialBalance1 = parseFloat(store.get(`initial_${MARKET1.toLowerCase()}_balance`))
    const initialBalance2 = parseFloat(store.get(`initial_${MARKET2.toLowerCase()}_balance`))

    return parseFloat(parseFloat((m1Balance - initialBalance1) * price + m2Balance) - initialBalance2).toFixed(4)
}

function _logProfits(price) {
    const profits = parseFloat(store.get('profits'))
    var isGainerProfit = profits > 0 ?
        1 : profits < 0 ? 2 : 0

    logColor(isGainerProfit == 1 ?
        colors.green : isGainerProfit == 2 ?
            colors.red : colors.gray,
        `Grid Profits (Incl. fees): ${parseFloat(store.get('profits')).toFixed(4)} ${MARKET2}`)

    const m1Balance = parseFloat(store.get(`${MARKET1.toLowerCase()}_balance`))
    const m2Balance = parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`))

    const initialBalance = parseFloat(store.get(`initial_${MARKET2.toLowerCase()}_balance`))

    logColor(colors.gray,
        `Balance: ${m1Balance} ${MARKET1}, ${m2Balance.toFixed(2)} ${MARKET2}`)
    logColor(colors.gray,
        `Current: ${parseFloat(m1Balance * price + m2Balance).toFixed(2)} ${MARKET2}, Initial: ${initialBalance.toFixed(2)} ${MARKET2}`)
}

async function getFees({ commission, commissionAsset }) {
    if (commissionAsset === MARKET2) return commission
    const price = await getPrice(MARKET)
    return price * commission
}

async function _buy(price, amount) {
    if (parseFloat(store.get(`${MARKET2.toLowerCase()}_balance`)) >= BUY_ORDER_AMOUNT) {
        var orders = store.get('orders')
        var sellFactor = process.env.SELL_PERCENT * price / 100
        var slFactor = process.env.STOP_LOSS_GRID * price / 100

        const order = {
            buy_price: price,
            sell_price: price + sellFactor,
            sl_price: price - slFactor,
            sold_price: 0,
            status: 'pending',
            profit: 0,
            buy_fee: 0,
            sell_fee: 0,
        }

        log(`
            Buying ${MARKET1}
            ==================
            amountIn: ${parseFloat(BUY_ORDER_AMOUNT).toFixed(2)} ${MARKET2}
            amountOut: ${BUY_ORDER_AMOUNT / price} ${MARKET1}
        `)

        const res = await marketBuy(amount, true)
        if (res && res.status === 'FILLED') {
            order.status = 'bought'
            order.id = res.orderId
            order.buy_fee = parseFloat((await getFees(res.fills[0])))
            order.amount = res.executedQty - res.fills[0].commission
            store.put('fees', parseFloat(store.get('fees')) + order.buy_fee)
            order.buy_price = parseFloat(res.fills[0].price)

            orders.push(order)
            store.put('start_price', order.buy_price)
            await _updateBalances()

            logColor(colors.green, '=============================')
            logColor(colors.green, `Bought ${order.amount} ${MARKET1} for ${parseFloat(BUY_ORDER_AMOUNT).toFixed(2)} ${MARKET2}, Price: ${order.buy_price}\n`)
            logColor(colors.green, '=============================')

            await _calculateProfits()

            _notifyTelegram(price, 'buy')
        } else _newPriceReset(2, BUY_ORDER_AMOUNT, price)
    } else _newPriceReset(2, BUY_ORDER_AMOUNT, price)
}

function canNotifyTelegram(from) {
    return process.env.NOTIFY_TELEGRAM_ON.includes(from)
}

function _notifyTelegram(price, from) {
    moment.locale('es')
    if (process.env.NOTIFY_TELEGRAM
        && canNotifyTelegram(from))
        NotifyTelegram({
            runningTime: elapsedTime(),
            market: MARKET,
            market1: MARKET1,
            market2: MARKET2,
            price: price,
            balance1: store.get(`${MARKET1.toLowerCase()}_balance`),
            balance2: store.get(`${MARKET2.toLowerCase()}_balance`),
            gridProfits: parseFloat(store.get('profits')).toFixed(4),
            realProfits: getRealProfits(price),
            start: moment(store.get('start_time')).format('DD/MM/YYYY HH:mm'),
            from
        })
}

async function marketBuy(amount, quoted) {
    return await marketOrder('BUY', amount, quoted)
}

async function marketOrder(side, amount, quoted) {
    const orderObject = {
        symbol: MARKET,
        side: side,
        type: 'MARKET',
    }

    if (quoted)
        orderObject['quoteOrderQty'] = amount
    else
        orderObject['quantity'] = amount

    return await client.order(orderObject)
}

async function marketSell(amount) {
    return await marketOrder('SELL', amount)
}

async function clearStart() {
    await _closeBot()
    const balances = await getBalances()
    const totalAmount = balances[MARKET1]
    const price = await getPrice(MARKET)
    const minSell = (await getMinBuy()) / price
    if (totalAmount >= parseFloat(minSell)) {
        try {
            const lotQuantity = await getQuantity(totalAmount)
            const res = await marketSell(lotQuantity)
            if (res && res.status === 'FILLED') {
                logColor(colors.green, 'Iniciando en modo limpio...')
                await sleep(3000)
            } else {
                logFail()
            }
        } catch (err) {
            logFail()
        }
    }
}

function logFail() {
    logColor(colors.red, 'No se ha podido vender el saldo inicial.')
    logColor(colors.red, 'Debes venderlo manualmente en Binance.')
    process.exit()
}

async function _sellAll() {
    await sleep(3000)
    const balances = await getBalances()
    const totalAmount = balances[MARKET1]
    if (totalAmount > 0) {
        try {
            const lotQuantity = await getQuantity(totalAmount)
            const res = await marketSell(lotQuantity)
            if (res && res.status === 'FILLED') {
                logColor(colors.green, 'Bot detenido correctamente: Todo vendido')
            } else {
                logFail()
            }
        } catch (err) { }
    }
}

async function _closeBot() {
    try {
        fs.unlinkSync(`./data/${MARKET}.json`)
    } catch (ee) { }
}

function getOrderId() {
    const fifoStrategy = process.env.STOP_LOSS_GRID_IS_FIFO
    const orders = store.get('orders')
    const index = fifoStrategy ? 0 : orders.length - 1

    return store.get('orders')[index].id
}

function getToSold(price, changeStatus) {
    const orders = store.get('orders')
    const toSold = []

    for (var i = 0; i < orders.length; i++) {
        var order = orders[i]
        if (price >= order.sell_price ||
            (process.env.USE_STOP_LOSS_GRID
                && getOrderId() === order.id
                && store.get(`${MARKET2.toLowerCase()}_balance`) < BUY_ORDER_AMOUNT
                && price < order.sl_price)) {
            if (changeStatus) {
                order.sold_price = price
                order.status = 'selling'
            }
            toSold.push(order)
        }
    }

    return toSold
}

async function _sell(price) {
    const orders = store.get('orders')
    const toSold = getToSold(price, true)

    if (toSold.length > 0) {
        var totalAmount = parseFloat(toSold.map(order => order.amount).reduce((prev, next) => parseFloat(prev) + parseFloat(next)))
        const balance = parseFloat(store.get(`${MARKET1.toLowerCase()}_balance`))
        totalAmount = totalAmount > balance ? balance : totalAmount
        if (totalAmount > 0) {
            log(`
                Selling ${MARKET1}
                =================
                amountIn: ${totalAmount.toFixed(2)} ${MARKET1}
                amountOut: ${parseFloat(totalAmount * price).toFixed(2)} ${MARKET2}
            `)

            const lotQuantity = await getQuantity(totalAmount)
            const res = await marketSell(lotQuantity)
            if (res && res.status === 'FILLED') {
                const _price = parseFloat(res.fills[0].price)

                for (var i = 0; i < orders.length; i++) {
                    var order = orders[i]
                    for (var j = 0; j < toSold.length; j++) {
                        if (order.id == toSold[j].id) {
                            toSold[j].profit = (parseFloat(toSold[j].amount) * _price)
                                - (parseFloat(toSold[j].amount) * parseFloat(toSold[j].buy_price))

                            toSold[j].profit -= order.sell_fee + order.buy_fee
                            toSold[j].sell_fee = parseFloat((await getFees(res.fills[0])))
                            toSold[j].status = 'sold'
                            orders[i] = toSold[j]
                            store.put('fees', parseFloat(store.get('fees')) + orders[i].sell_fee)
                            store.put('sl_losses', parseFloat(store.get('sl_losses')) + orders[i].profit)
                        }
                    }
                }

                store.put('start_price', _price)
                await _updateBalances()

                logColor(colors.red, '=============================')
                logColor(colors.red,
                    `Sold ${totalAmount} ${MARKET1} for ${parseFloat(totalAmount * _price).toFixed(2)} ${MARKET2}, Price: ${_price}\n`)
                logColor(colors.red, '=============================')

                await _calculateProfits()

                var i = orders.length
                while (i--)
                    if (orders[i].status === 'sold')
                        orders.splice(i, 1)

                _notifyTelegram(price, 'sell')
            } else store.put('start_price', price)
        } else store.put('start_price', price)
    }

    return toSold.length > 0
}

async function broadcast() {
    while (true) {
        try {
            const mPrice = await getPrice(MARKET)
            if (mPrice) {
                const startPrice = store.get('start_price')
                const marketPrice = mPrice

                console.clear()
                log(`Running Time: ${elapsedTime()}`)
                log('===========================================================')
                const totalProfits = getRealProfits(marketPrice)

                if (!isNaN(totalProfits)) {
                    const totalProfitsPercent = parseFloat(
                        100 * totalProfits / store.get(`initial_${MARKET2.toLowerCase()}_balance`)
                    ).toFixed(3)
                    log(`Withdrawal profits: ${parseFloat(store.get('withdrawal_profits')).toFixed(2)} ${MARKET2}`)
                    logColor(totalProfits < 0 ? colors.red : totalProfits == 0 ? colors.gray : colors.green,
                        `Real Profits [SL = ${process.env.STOP_LOSS_BOT}%, TP = ${process.env.TAKE_PROFIT_BOT}%]: ${totalProfitsPercent}% ==> ${totalProfits <= 0 ? '' : '+'}${parseFloat(totalProfits).toFixed(3)} ${MARKET2}`)

                    if (totalProfitsPercent >= parseFloat(process.env.TAKE_PROFIT_BOT)) {
                        logColor(colors.green, 'Cerrando bot en ganancias....')
                        if (process.env.SELL_ALL_ON_CLOSE) {
                            if (process.env.WITHDRAW_PROFITS
                                && totalProfits >= parseFloat(process.env.MIN_WITHDRAW_AMOUNT)) {
                                await withdraw(totalProfits, marketPrice)
                                if (process.env.START_AGAIN) {
                                    await sleep(5000)
                                    await _updateBalances()
                                } else {
                                    await _closeBot()
                                    return
                                }
                            } else {
                                await _sellAll()
                                await _closeBot()

                                return
                            }
                        } else {
                            return
                        }
                    } else if (totalProfitsPercent <= -1 * process.env.STOP_LOSS_BOT) {
                        logColor(colors.red, 'Cerrando bot en pérdidas....')
                        if (process.env.SELL_ALL_ON_CLOSE)
                            await _sellAll()
                        await _closeBot()
                        return
                    }
                }

                _logProfits(marketPrice)
                const entryPrice = store.get('entry_price')
                const entryFactor = (marketPrice - entryPrice)
                const entryPercent = parseFloat(100 * entryFactor / entryPrice).toFixed(2)
                log(`Entry price: ${store.get('entry_price')} ${MARKET2} (${entryPercent <= 0 ? '' : '+'}${entryPercent}%)`)
                log('===========================================================')

                log(`Prev price: ${startPrice} ${MARKET2}`)

                if (marketPrice < startPrice) {
                    var factor = (startPrice - marketPrice)
                    var percent = parseFloat(100 * factor / startPrice).toFixed(2)

                    logColor(colors.red,
                        `New price: ${marketPrice} ${MARKET2} ==> -${parseFloat(percent).toFixed(3)}%`)
                    store.put('percent', `-${parseFloat(percent).toFixed(3)}`)

                    if (percent >= process.env.BUY_PERCENT)
                        await _buy(marketPrice, BUY_ORDER_AMOUNT)
                } else {
                    const factor = (marketPrice - startPrice)
                    const percent = 100 * factor / marketPrice

                    logColor(colors.green,
                        `New price: ${marketPrice} ${MARKET2} ==> +${parseFloat(percent).toFixed(3)}%`)
                    store.put('percent', `+${parseFloat(percent).toFixed(3)}`)

                    const toSold = getToSold(marketPrice)
                    if (toSold.length === 0)
                        store.put('start_price', marketPrice)
                }

                await _sell(marketPrice)

                const orders = store.get('orders')
                if (orders.length > 0) {
                    const bOrder = orders[orders.length - 1]
                    console.log()
                    log('Last buy order')
                    console.log('==========================')
                    log(`Buy price: ${bOrder.buy_price} ${MARKET2}`)
                    log(`Sell price: ${bOrder.sell_price} ${MARKET2}`)

                    if (process.env.USE_STOP_LOSS_GRID) {
                        const slStrategy = process.env.STOP_LOSS_GRID_IS_FIFO ? 'FIFO' : 'LIFO'
                        log(`SL price: ${bOrder.sl_price} ${MARKET2}, Strategy: ${slStrategy}`)
                        log(`SL losses: ${parseFloat(store.get('sl_losses')).toFixed(3)}, Trigger price down: ${process.env.STOP_LOSS_GRID}%`)
                    }

                    log(`Order amount: ${BUY_ORDER_AMOUNT} ${MARKET2} ==> ${bOrder.amount} ${MARKET1}`)

                    const expectedProfits = parseFloat((bOrder.amount * bOrder.sell_price - bOrder.amount * bOrder.buy_price) - bOrder.buy_fee).toFixed(3)
                    if (expectedProfits >= 0)
                        logColor(colors.green, `Expected profit: +${expectedProfits} ${MARKET2}`)
                    else
                        logColor(colors.red, `Expected profit: ${expectedProfits} ${MARKET2}`)

                    console.log('==========================')
                }
            }
        } catch (err) { }
        await sleep(process.env.SLEEP_TIME)
    }
}


const getBalances = async () => {
    const assets = [MARKET1, MARKET2]
    const { balances } = await client.accountInfo()
    const _balances = balances.filter(coin => assets.includes(coin.asset))
    var parsedBalnaces = {}
    assets.forEach(asset => {
        parsedBalnaces[asset] = parseFloat(_balances.find(coin => coin.asset === asset).free)
    })
    return parsedBalnaces
}

const getPrice = async (symbol) => {
    return parseFloat((await client.prices({ symbol }))[symbol])
}

const getQuantity = async (amount) => {
    const { symbols } = await client.exchangeInfo({ symbol: MARKET })
    const { stepSize } = symbols[0].filters.find(filter => filter.filterType === 'LOT_SIZE')
    let quantity = (amount / stepSize).toFixed(symbols[0].baseAssetPrecision)

    if (amount % stepSize !== 0) {
        quantity = (parseInt(quantity) * stepSize).toFixed(symbols[0].baseAssetPrecision)
    }

    return quantity
}

async function getMinBuy() {
    const { symbols } = await client.exchangeInfo({ symbol: MARKET })
    const { minNotional } = symbols[0].filters.find(filter => filter.filterType === 'NOTIONAL')

    return parseFloat(minNotional)
}

async function withdraw(profits, price) {
    await _sellAll()
    console.log('Procesando retiro...')
    await sleep(process.env.SLEEP_TIME * 2)

    await client.withdraw({
        coin: MARKET2,
        network: process.env.DEFAULT_WITHDRAW_NETWORK,
        address: MARKET2 === 'BUSD'
            ? process.env.WITHDRAW_ADDRESS_BUSD
            : process.env.WITHDRAW_ADDRESS_USDT,
        amount: profits,
    })

    store.put('withdrawal_profits', parseFloat(store.get('withdrawal_profits')) + profits)
    console.log('Cerrando bot...')
    await sleep(process.env.SLEEP_TIME * 2)
    _notifyTelegram(price, 'withdraw')
}

async function init() {
    const minBuy = await getMinBuy()
    if (minBuy > BUY_ORDER_AMOUNT) {
        console.log(`El lote mínimo de compra es: ${minBuy} ${MARKET2}`)
        return
    }

    if (process.argv[5] !== 'resume') {
        log('Iniciando bot...')
        if (process.env.SELL_ALL_ON_START)
            await clearStart()
        const startTime = Date.now()
        store.put('start_time', startTime)
        const price = await getPrice(MARKET)
        store.put('start_price', price)
        store.put('orders', [])
        store.put('profits', 0)
        store.put('sl_losses', 0)
        store.put('withdrawal_profits', 0)
        store.put('fees', 0)
        const balances = await getBalances()
        store.put('entry_price', price)
        store.put(`${MARKET1.toLowerCase()}_balance`, balances[MARKET1])
        store.put(`${MARKET2.toLowerCase()}_balance`, balances[MARKET2])
        store.put(`initial_${MARKET1.toLowerCase()}_balance`, store.get(`${MARKET1.toLowerCase()}_balance`))
        store.put(`initial_${MARKET2.toLowerCase()}_balance`, store.get(`${MARKET2.toLowerCase()}_balance`))
    }

    broadcast()
}

init()