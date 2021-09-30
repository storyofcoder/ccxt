'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require('./base/Exchange');
const { ExchangeError, ExchangeNotAvailable, BadResponse, BadRequest, InvalidOrder, InsufficientFunds, AuthenticationError, ArgumentsRequired, InvalidAddress, RateLimitExceeded, DDoSProtection, BadSymbol } = require('./base/errors');
const { TRUNCATE, TICK_SIZE } = require('./base/functions/number');
const { redisRead, redisWrite } = require('../../../lib/utils');

//  ---------------------------------------------------------------------------

module.exports = class lcxstaging extends Exchange {
    describe() {
        return this.deepExtend(super.describe(), {
            'id': 'lcxstaging',
            'name': 'lcxstaging',
            'countries': ['SW'],
            'rateLimit': 250, // ms
            'has': {
                'CORS': true,
                // 'fetchTime': true,
                'fetchMarkets': true,
                'fetchCurrencies': false,
                'fetchTickers': true,
                'fetchTicker': true,
                'fetchOHLCV': true,
                'fetchOrderBook': true,
                'fetchTrades': true,
                'fetchBalance': true,
                'createOrder': true,
                // 'createMarketOrder': true,
                'cancelOrder': true,
                // 'fetchOrder': true,
                'fetchOpenOrders': true,
                'fetchClosedOrders': true,
                'fetchMyTrades': true,
                // 'fetchDepositAddress': true,
                // 'withdraw': true,
                'signIn': true,
            },
            'timeframes': {
                '1m': '1m',
                '3m': '3m',
                '5m': '5m',
                '10m': '10m',
                '15m': '15m',
                '30m': '30m',
                '1h': '1h',
                '4h': '4h',
                '6h': '6h',
                '12h': '12h',
                '1d': '1D',
                '1w': '1W',
                '1M': '1M',
            },
            'version': 'v1',
            'urls': {
                'logo': 'https://web.lcx.com/wp-content/uploads/2018/12/logo_black.png',
                'api': {
                    'accounts': 'https://trading-api-staging.lcx.com',
                    'public': 'https://trading-api-staging.lcx.com',
                    'private': 'https://trading-api-staging.lcx.com',
                },
                'www': 'https://www.lcx.com',
                'doc': [
                    'https://exchange.lcx.com/v1/docs',
                ],
                'fees': 'https://exchange.lcx.com/setting/fees',
                'referral': 'https://accounts.lcx.com/register?referralCode=CCXT_DOCS',
            },
            'api': {
                'public': {
                    'get': [
                        'market/pairs',
                        'currency',
                        'market/tickers',
                    ],
                    'post': [
                        'order/book',
                        'market/ticker',
                        'market/kline',
                        'trade/recent'
                    ],
                },
                'private': {
                    'post': [
                        'orderHistory',
                        'open',
                        'create',
                        'cancel'
                    ],
                    'get': [
                        'balances'
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'maker': 0.2 / 100,
                    'taker': 0.2 / 100,
                },
            },
            'exceptions': {
                'exact': {
                    'UNAUTHORIZED': AuthenticationError,
                    'INVALID_ARGUMENT': BadRequest, // Parameters are not a valid format, parameters are empty, or out of range, or a parameter was sent when not required.
                    'TRADING_UNAVAILABLE': ExchangeNotAvailable,
                    'NOT_ENOUGH_BALANCE': InsufficientFunds,
                    'NOT_ALLOWED_COMBINATION': BadRequest,
                    'INVALID_ORDER': InvalidOrder, // Requested order does not exist, or it is not your order
                    'RATE_LIMIT_EXCEEDED': RateLimitExceeded, // You are sending requests too frequently. Please try it later.
                    'MARKET_UNAVAILABLE': ExchangeNotAvailable, // Market is closed today
                    'INVALID_MARKET': BadSymbol, // Requested market is not exist
                    'INVALID_CURRENCY': BadRequest, // Requested currency is not exist on ProBit system
                    'TOO_MANY_OPEN_ORDERS': DDoSProtection, // Too many open orders
                    'DUPLICATE_ADDRESS': InvalidAddress, // Address already exists in withdrawal address list
                },
            },
            'requiredCredentials': {
                'apiKey': true,
                'secret': true,
            },
            'precisionMode': TICK_SIZE,
            'options': {
                'createMarketBuyOrderRequiresPrice': true,
                'timeInForce': {
                    'limit': 'gtc',
                    'market': 'ioc',
                },
            },
            'commonCurrencies': {
                'BTCBEAR': 'BEAR',
                'BTCBULL': 'BULL',
                'CBC': 'CryptoBharatCoin',
                'UNI': 'UNICORN Token',
            },
        });
    }

    async fetchMarkets(params = {}) {
        let cacheData = await redisRead(this.id + '|markets');
        if (cacheData) return cacheData;
        else {
            const response = await this.publicGetMarketPairs(params);
            const markets = this.safeValue(response, 'data', []);
            const result = [];
            for (let i = 0; i < markets.length; i++) {
                const market = markets[i];
                const id = this.safeString(market, 'symbol');
                const baseId = this.safeString(market, 'base');
                const quoteId = this.safeString(market, 'quote');
                const base = this.safeString(market, 'base');
                const quote = this.safeString(market, 'quote');
                const symbol = base + '/' + quote;
                const active = this.safeValue(market, 'status', false);
                const amountPrecision = this.safeInteger(market, 'amountPrecision');
                const costPrecision = this.safeInteger(market, 'amountPrecision');
                const precision = {
                    'amount': amountPrecision,
                    'price': this.safeFloat(market, 'pricePrecision'),
                    'cost': costPrecision,
                };
                const takerFeeRate = this.safeFloat(market, 'taker_fee_rate');  // need 
                const makerFeeRate = this.safeFloat(market, 'maker_fee_rate');  // need
                result.push({
                    'id': id,
                    'info': market,
                    'symbol': symbol,
                    'base': base,
                    'quote': quote,
                    'baseId': baseId,
                    'quoteId': quoteId,
                    'active': active,
                    'precision': precision,
                    'taker': takerFeeRate / 100,
                    'maker': makerFeeRate / 100,
                    'limits': {
                        'amount': {
                            'min': this.safeFloat(market, 'minBaseOrder'),
                            'max': this.safeFloat(market, 'maxBaseOrder'),
                        },
                        'price': {
                            'min': this.safeFloat(market, 'min_price'),
                            'max': this.safeFloat(market, 'max_price'),
                        },
                        'cost': {
                            'min': this.safeFloat(market, 'minQuoteOrder'),
                            'max': this.safeFloat(market, 'maxQuoteOrder'),
                        },
                    },
                });
            }

            // Storing markets in Redis
            await redisWrite(this.id + '|markets', result, false, 60 * 60);
            return result;
        }
    }

    async fetchCurrencies(params = {}) {
        const response = await this.publicGetCurrencyWithPlatform(params);

        const currencies = this.safeValue(response, 'data');
        const result = {};
        for (let i = 0; i < currencies.length; i++) {
            const currency = currencies[i];
            const id = this.safeString(currency, 'id');
            const code = this.safeCurrencyCode(id);
            const displayName = this.safeValue(currency, 'display_name');
            const name = this.safeString(displayName, 'en-us');
            const platforms = this.safeValue(currency, 'platform', []);
            const platformsByPriority = this.sortBy(platforms, 'priority');
            const platform = this.safeValue(platformsByPriority, 0, {});
            const precision = this.safeInteger(platform, 'precision');
            const depositSuspended = this.safeValue(platform, 'deposit_suspended');
            const withdrawalSuspended = this.safeValue(platform, 'withdrawal_suspended');
            const active = !(depositSuspended && withdrawalSuspended);
            const withdrawalFees = this.safeValue(platform, 'withdrawal_fee', {});
            const withdrawalFeesByPriority = this.sortBy(withdrawalFees, 'priority');
            const withdrawalFee = this.safeValue(withdrawalFeesByPriority, 0, {});
            const fee = this.safeFloat(withdrawalFee, 'amount');
            result[code] = {
                'id': id,
                'code': code,
                'info': currency,
                'name': name,
                'active': active,
                'fee': fee,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': Math.pow(10, -precision),
                        'max': Math.pow(10, precision),
                    },
                    'price': {
                        'min': Math.pow(10, -precision),
                        'max': Math.pow(10, precision),
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'deposit': {
                        'min': this.safeFloat(platform, 'min_deposit_amount'),
                        'max': undefined,
                    },
                    'withdraw': {
                        'min': this.safeFloat(platform, 'min_withdrawal_amount'),
                        'max': undefined,
                    },
                },
            };
        }
        return result;
    }

    async fetchBalance(params = {}) {

        const response = await this.privateGetBalances({});
        //
        //     {
        //         data: [
        //             {
        //                 "currency_id":"XRP",
        //                 "total":"100",
        //                 "available":"0",
        //             }
        //         ]
        //     }
        //
        const data = this.safeValue(response, 'data');
        const result = { 'info': data };
        for (let i = 0; i < data.length; i++) {
            const balance = data[i];
            const code = this.safeString(balance, 'coin');
            const account = this.account();
            account['total'] = this.safeFloat(balance.balance, 'totalBalance');
            account['free'] = this.safeFloat(balance.balance, 'freeBalance');
            account['used'] = this.safeFloat(balance.balance, 'occupiedBalance');
            result[code] = account;
        }
        return this.parseBalance(result);
    }

    async fetchOrderBook(symbol, limit = undefined, params = {}) {
        const request = {
            'pair': symbol,
        };

        const response = await this.publicPostOrderBook(this.extend(request, params));
        //
        //     data:{buy: Array(6), sell: Array(6)}
        // buy:(6) [
        // 0:(2) [0.0289968, 1.33]
        // 1:(2) [0.024, 1]
        // 2:(2) [0.023, 30.5]
        // 3:(2) [0.022, 1]
        // 4:(2) [0.02, 0]
        // 5:(2) [0.018, 2.1]
        //     ]
        // sell:[
        // 0:(2) [0.029, 1.1]
        // 1:(2) [0.03, 32.6]
        // 2:(2) [0.03067, 0.5]
        // 3:(2) [0.03167, 1.6282]
        // 4:(2) [0.03168, 0.3]
        // 5:(2) [0.0329968, 0.33662]
        // ]
        // message:'Successfully Api response'
        // status:'success'
        //
        let orderbook = this.safeValue(response, 'data', {});
        if (orderbook.sell) orderbook.sell = orderbook.sell.filter(a => { if (a && a[1]) return a; });
        if (orderbook.buy) orderbook.buy = orderbook.buy.filter(a => { if (a && a[1]) return a; });
        return {
            'bids': this.safeValue(orderbook, 'buy', []),
            'asks': this.safeValue(orderbook, 'sell', []),
            'timestamp': undefined,
            'datetime': undefined,
            'nonce': undefined,
        }
    }

    async fetchTickers(symbols = undefined, params = {}) {
        // await this.loadMarkets();
        const request = {};
        const response = await this.publicGetMarketTickers(this.extend(request, params));
        //
        //     {
        //         "data":[
        //             {
        //                 "last":"0.022902",
        //                 "low":"0.021693",
        //                 "high":"0.024093",
        //                 "change":"-0.000047",
        //                 "base_volume":"15681.986",
        //                 "quote_volume":"360.514403624",
        //                 "market_id":"ETH-BTC",
        //                 "time":"2020-04-12T18:43:38.000Z"
        //             }
        //         ]
        //     }
        //
        const data = this.safeValue(response, 'data', []);
        return this.parseTickers(data);
    }

    parseTickers(rawTickers, symbols = undefined) {
        const tickers = [];
        rawTickers = Object.values(rawTickers);
        for (let i = 0; i < rawTickers.length; i++) {
            tickers.push(this.parseTicker(rawTickers[i]));
        }
        return this.filterByArray(tickers, 'symbol', symbols);
    }

    async fetchTicker(symbol, params = {}) {
        const request = {
            'pair': symbol,
        };
        params['pair'] = symbol;
        const response = await this.publicPostMarketTicker(this.extend(request, params));
        //
        //     {
        //         "data": {
        //                 "last":"0.022902",
        //                 "low":"0.021693",
        //                 "high":"0.024093",
        //                 "change":"-0.000047",
        //                 "base_volume":"15681.986",
        //                 "quote_volume":"360.514403624",
        //                 "market_id":"ETH-BTC",
        //                 "time":"2020-04-12T18:43:38.000Z"
        //             },
        //          
        //         "message": 'Successfully Api response'
        //     }
        //
        const ticker = this.safeValue(response, 'data', []);
        if (ticker === undefined) {
            throw new BadResponse(this.id + ' fetchTicker() returned an empty response');
        }
        return this.parseTicker(ticker);
    }

    parseTicker(ticker, market = undefined) {
        //
        //     {
        //         "last":"0.022902",
        //         "low":"0.021693",
        //         "high":"0.024093",
        //         "change":"-0.000047",
        //         "base_volume":"15681.986",
        //         "quote_volume":"360.514403624",
        //         "market_id":"ETH-BTC",
        //         "time":"2020-04-12T18:43:38.000Z"
        //     }
        //
        const timestamp = this.safeInteger(ticker, 'lastUpdated');
        const marketId = this.safeString(ticker, 'symbol');
        const symbol = this.safeString(ticker, 'symbol');
        const close = this.safeFloat(ticker, 'lastPrice');
        const change = this.safeFloat(ticker, 'change');
        let percentage = undefined;
        let open = undefined;
        if (change !== undefined) {
            if (close !== undefined) {
                open = close - change;
                percentage = open ? (change / open) * 100 : 0;
            }
        }
        const baseVolume = this.safeFloat(ticker, 'volume');
        const quoteVolume = this.safeFloat(ticker, 'volume'); // base quote volume calc formula
        // const vwap = this.vwap(baseVolume, quoteVolume);
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'high': this.safeFloat(ticker, 'high'),
            'low': this.safeFloat(ticker, 'low'),
            'ask': this.safeFloat(ticker, 'bestAsk'),
            'bid': this.safeFloat(ticker, 'bestBid'),
            'open': open,
            'close': close,
            'last': close,
            'change': change,
            'percentage': percentage,
            'average': undefined,
            'baseVolume': baseVolume,
            'quoteVolume': quoteVolume,
            'info': ticker,
        };
    }

    async fetchMyTrades(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = {};
        const market = undefined;
        if (symbol !== undefined) {
            request["pair"] = symbol;
            request["offset"] = 1
        }
        // if (since) {
        //     request['start_time'] = this.iso8601(since);
        // }
        // if (limit) {
        //     request['limit'] = limit;
        // }

        const response = await this.privatePostOrderHistory(this.extend(request, params));
        const data = this.safeValue(response, 'data');
        return this.parseOrders(data, market, since, limit);
    }

    async fetchTrades(symbol, since = undefined, limit = undefined, params = {}) {
        const request = {
            'pair': symbol,
            'offset': 1
        };
        if (params.page !== undefined) {
            request['offset'] = params.page;
        }

        const response = await this.publicPostTradeRecent(this.extend(request, params));
        //
        //     {
        //         "data":[
        // [
        // 0:0.023          // price 
        // 1:0.1            // amount
        // 2:'BUY'          // side
        // 3:1605937174     // timestamp
        // ],
        // [
        // 0:0.023          // price 
        // 1:0.1            // amount
        // 2:'BUY'          // side
        // 3:1605937174     // timestamp
        // ]
        //         ]
        //     }
        //
        const data = this.safeValue(response, 'data', []);
        return this.parseTrades(data, undefined, since, limit);
    }

    parseTrade(trade, market = undefined) {

        const timestamp = trade[3];
        const id = trade[3];
        let marketId = undefined;
        const symbol = undefined
        let side = this.safeString(trade[2], 'side');
        side = (side == 'BUY') ? "buy" : "sell";
        const price = trade[0];
        const amount = trade[1]
        let cost = undefined;
        const orderId = undefined;
        const feeCost = undefined;

        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'symbol': undefined,
            'order': orderId,
            'type': undefined,
            'side': side,
            'takerOrMaker': undefined,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'fee': undefined,
        };
    }

    async fetchTime(params = {}) {
        const response = await this.publicGetTime(params);
        //
        //     { "data":"2020-04-12T18:54:25.390Z" }
        //
        const timestamp = this.parse8601(this.safeString(response, 'data'));
        return timestamp;
    }

    normalizeOHLCVTimestamp(timestamp, timeframe, after = false) {
        const duration = this.parseTimeframe(timeframe);
        if (timeframe === '1M') {
            const iso8601 = this.iso8601(timestamp);
            const parts = iso8601.split('-');
            const year = this.safeString(parts, 0);
            let month = this.safeInteger(parts, 1);
            if (after) {
                month = this.sum(month, 1);
            }
            if (month < 10) {
                month = '0' + month.toString();
            } else {
                month = month.toString();
            }
            return year + '-' + month + '-01T00:00:00.000Z';
        } else if (timeframe === '1w') {
            timestamp = parseInt(timestamp / 1000);
            const firstSunday = 259200; // 1970-01-04T00:00:00.000Z
            const difference = timestamp - firstSunday;
            const numWeeks = this.integerDivide(difference, duration);
            let previousSunday = this.sum(firstSunday, numWeeks * duration);
            if (after) {
                previousSunday = this.sum(previousSunday, duration);
            }
            return this.iso8601(previousSunday * 1000);
        } else {
            timestamp = parseInt(timestamp / 1000);
            timestamp = duration * parseInt(timestamp / duration);
            if (after) {
                timestamp = this.sum(timestamp, duration);
            }
            return this.iso8601(timestamp * 1000);
        }
    }

    async fetchOHLCV(symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        const request = {
            'pair': symbol,
            'resolution': this.timeframes[timeframe],
        };
        if (since !== undefined) {
            request['from'] = since;
        }
        if (params.last) {
            request['to'] = params.last;
        }
        const response = await this.publicPostMarketKline(this.extend(request, params));
        return this.parseOHLCVs(response, market, timeframe, since, limit);
    }

    parseOHLCV(ohlcv, market = undefined) {
        //
        //     {
        //         "market_id":"ETH-BTC",
        //         "open":"0.02811",
        //         "close":"0.02811",
        //         "low":"0.02811",
        //         "high":"0.02811",
        //         "base_volume":"0.0005",
        //         "quote_volume":"0.000014055",
        //         "start_time":"2018-11-30T18:19:00.000Z",
        //         "end_time":"2018-11-30T18:20:00.000Z"
        //     }
        //
        return [
            this.parse8601(this.safeString(ohlcv, 'start_time')),
            this.safeFloat(ohlcv, 'open'),
            this.safeFloat(ohlcv, 'high'),
            this.safeFloat(ohlcv, 'low'),
            this.safeFloat(ohlcv, 'close'),
            this.safeFloat(ohlcv, 'base_volume'),
        ];
    }

    async fetchOpenOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        since = this.parse8601(since);
        const request = {};
        let market = undefined;
        if (symbol !== undefined) {
            request['pair'] = symbol;
        }
        if (params.offset) request['offset'] = params.offset;
        else request['offset'] = 1;

        if (since) {
            request['fromDate'] = this.iso8601(since);
            request['toDate'] = this.iso8601(Date.now());
        }

        const response = await this.privatePostOpen(this.extend(request, params));
        const data = this.safeValue(response, 'data');
        return this.parseOrders(data, market, since, limit);
    }

    async fetchClosedOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = {};
        const market = undefined;
        if (symbol !== undefined) {
            request["pair"] = symbol;
            request["offset"] = 1
        }
        if (since) {
            request['fromDate'] = this.iso8601(since);
            request['toDate'] = this.iso8601(Date.now());
        }

        const response = await this.privatePostOrderHistory(this.extend(request, params));
        const data = this.safeValue(response, 'data');
        let orders = this.parseOrders(data, market, since, limit);
        return this.filterBy(orders, 'status', 'closed');
    }

    async fetchOrder(id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired(this.id + ' fetchOrder requires a symbol argument');
        }
        await this.loadMarkets();
        const market = this.market(symbol);
        const request = {
            'market_id': market['id'],
        };
        const clientOrderId = this.safeString2(params, 'clientOrderId', 'client_order_id');
        if (clientOrderId !== undefined) {
            request['client_order_id'] = clientOrderId;
        } else {
            request['order_id'] = id;
        }
        const query = this.omit(params, ['clientOrderId', 'client_order_id']);

        const response = await this.privateGetOrder(this.extend(request, query));
        const data = this.safeValue(response, 'data', []);
        const order = this.safeValue(data, 0);
        return this.parseOrder(order, market);
    }

    parseOrderStatus(status) {
        const statuses = {
            'open': 'open',
            'cancelled': 'canceled',
            'filled': 'closed',
        };
        return this.safeString(statuses, status, status);
    }

    parseOrder(order, market = undefined) {
        //
        //     {
        //         id: string,
        //         user_id: string,
        //         market_id: string,
        //         type: 'orderType',
        //         side: 'side',
        //         quantity: string,
        //         limit_price: string,
        //         time_in_force: 'timeInForce',
        //         filled_cost: string,
        //         filled_quantity: string,
        //         open_quantity: string,
        //         cancelled_quantity: string,
        //         status: 'orderStatus',
        //         time: 'date',
        //         client_order_id: string,
        //     }
        //
        let status = this.parseOrderStatus(this.safeString(order, 'Status'));
        const id = this.safeString(order, 'Id');
        let side = this.safeString(order, 'Side');
        let type = this.safeString(order, 'OrderType');
        type = type.toLowerCase();
        status = status.toLowerCase();
        side = side.toLowerCase();
        const symbol = this.safeString(order, 'Pair');
        const timestamp = this.safeFloat(order, 'UpdatedAt');
        let price = this.safeFloat(order, 'Price');
        const filled = this.safeFloat(order, 'Filled');
        let remaining = this.safeFloat(order, 'Amount');
        const canceledAmount = this.safeFloat(order, 'cancelled_quantity');
        if (canceledAmount !== undefined) {
            remaining = this.sum(remaining, canceledAmount);
        }
        const amount = this.safeFloat(order, 'Amount');
        let cost = this.safeFloat2(order, 'Cost');
        if (type === 'market') {
            price = undefined;
        }
        let average = this.safeFloat(order, 'Average');;

        let clientOrderId = this.safeString(order, 'client_order_id');
        if (clientOrderId === '') {
            clientOrderId = undefined;
        }
        return {
            'id': id,
            'info': order,
            'clientOrderId': clientOrderId,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'lastTradeTimestamp': undefined,
            'symbol': symbol,
            'type': type,
            'side': side,
            'status': status,
            'price': price,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'average': average,
            'cost': cost,
            'fee': undefined,
            'trades': undefined,
        };
    }

    costToPrecision(symbol, cost) {
        return this.decimalToPrecision(cost, TRUNCATE, this.markets[symbol]['precision']['cost'], this.precisionMode);
    }

    async createOrder(symbol, type, side, amount, price = undefined, params = {}) {
        let request = {
            "Pair": symbol,
            "Amount": amount,
            "Price": price,
            "OrderType": type.toUpperCase(),
            "Side": side.toUpperCase(),
        }
        const response = await this.privatePostCreate(this.extend(request, params));
        const data = this.safeValue(response, 'data');
        return this.parseOrder(data);
    }

    async cancelOrder(id, symbol = undefined, params = {}) {
        const request = {
            'OrderId': id,
        };

        const response = await this.privatePostCancel(this.extend(request, params));
        const data = this.safeValue(response, 'data');
        return this.parseOrder(data);
    }

    // parseDepositAddress(depositAddress, currency = undefined) {
    //     const address = this.safeString(depositAddress, 'address');
    //     const tag = this.safeString(depositAddress, 'destination_tag');
    //     const currencyId = this.safeString(depositAddress, 'currency_id');
    //     const code = this.safeCurrencyCode(currencyId);
    //     this.checkAddress(address);
    //     return {
    //         'currency': code,
    //         'address': address,
    //         'tag': tag,
    //         'info': depositAddress,
    //     };
    // }

    // async fetchDepositAddress(code, params = {}) {
    //     await this.loadMarkets();
    //     const currency = this.currency(code);
    //     const request = {
    //         'currency_id': currency['id'],
    //     };

    //     const response = await this.privateGetDepositAddress(this.extend(request, params));
    //     //
    //     //     {
    //     //         "data":[
    //     //             {
    //     //                 "currency_id":"ETH",
    //     //                 "address":"0x12e2caf3c4051ba1146e612f532901a423a9898a",
    //     //                 "destination_tag":null
    //     //             }
    //     //         ]
    //     //     }
    //     //
    //     const data = this.safeValue(response, 'data', []);
    //     const firstAddress = this.safeValue(data, 0);
    //     if (firstAddress === undefined) {
    //         throw new InvalidAddress(this.id + ' fetchDepositAddress returned an empty response');
    //     }
    //     return this.parseDepositAddress(firstAddress, currency);
    // }

    // async fetchDepositAddresses(codes = undefined, params = {}) {
    //     await this.loadMarkets();
    //     const request = {};
    //     if (codes) {
    //         const currencyIds = [];
    //         for (let i = 0; i < codes.length; i++) {
    //             const currency = this.currency(codes[i]);
    //             currencyIds.push(currency['id']);
    //         }
    //         request['currency_id'] = codes.join(',');
    //     }

    //     const response = await this.privateGetDepositAddress(this.extend(request, params));
    //     const data = this.safeValue(response, 'data', []);
    //     return this.parseDepositAddresses(data);
    // }

    // parseDepositAddresses(addresses) {
    //     const result = {};
    //     for (let i = 0; i < addresses.length; i++) {
    //         const address = this.parseDepositAddress(addresses[i]);
    //         const code = address['currency'];
    //         result[code] = address;
    //     }
    //     return result;
    // }

    // async withdraw(code, amount, address, tag = undefined, params = {}) {
    //     // In order to use this method
    //     // you need to allow API withdrawal from the API Settings Page, and
    //     // and register the list of withdrawal addresses and destination tags on the API Settings page
    //     // you can only withdraw to the registered addresses using the API
    //     this.checkAddress(address);
    //     await this.loadMarkets();
    //     const currency = this.currency(code);
    //     if (tag === undefined) {
    //         tag = '';
    //     }
    //     const request = {
    //         'currency_id': currency['id'],
    //         // 'platform_id': 'ETH', // if omitted it will use the default platform for the currency
    //         'address': address,
    //         'destination_tag': tag,
    //         'amount': this.currencyToPrecision(code, amount),
    //         // which currency to pay the withdrawal fees
    //         // only applicable for currencies that accepts multiple withdrawal fee options
    //         // 'fee_currency_id': 'ETH', // if omitted it will use the default fee policy for each currency
    //         // whether the amount field includes fees
    //         // 'include_fee': false, // makes sense only when fee_currency_id is equal to currency_id
    //     };

    //     const response = await this.privatePostWithdrawal(this.extend(request, params));
    //     const data = this.safeValue(response, 'data');
    //     return this.parseTransaction(data, currency);
    // }

    parseTransaction(transaction, currency = undefined) {
        const id = this.safeString(transaction, 'id');
        const amount = this.safeFloat(transaction, 'amount');
        const address = this.safeString(transaction, 'address');
        const tag = this.safeString(transaction, 'destination_tag');
        const txid = this.safeString(transaction, 'hash');
        const timestamp = this.parse8601(this.safeString(transaction, 'time'));
        const type = this.safeString(transaction, 'type');
        const currencyId = this.safeString(transaction, 'currency_id');
        const code = this.safeCurrencyCode(currencyId);
        const status = this.parseTransactionStatus(this.safeString(transaction, 'status'));
        const feeCost = this.safeFloat(transaction, 'fee');
        let fee = undefined;
        if (feeCost !== undefined && feeCost !== 0) {
            fee = {
                'currency': code,
                'cost': feeCost,
            };
        }
        return {
            'id': id,
            'currency': code,
            'amount': amount,
            'addressFrom': undefined,
            'address': address,
            'addressTo': address,
            'tagFrom': undefined,
            'tag': tag,
            'tagTo': tag,
            'status': status,
            'type': type,
            'txid': txid,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'fee': fee,
            'info': transaction,
        };
    }

    parseTransactionStatus(status) {
        const statuses = {
            'requested': 'pending',
            'pending': 'pending',
            'confirming': 'pending',
            'confirmed': 'pending',
            'applying': 'pending',
            'done': 'ok',
            'cancelled': 'canceled',
            'cancelling': 'canceled',
        };
        return this.safeString(statuses, status, status);
    }

    nonce() {
        return this.milliseconds();
    }

    sign(path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api] + '/';
        const query = this.omit(params, this.extractParams(path));

        if (api === 'public') {
            if (method == 'POST') {
                url += this.implodeParams(path, params);
                body = this.json(query);
            } else {
                url += this.implodeParams(path, params);
                if (Object.keys(query).length) {
                    url += '?' + this.urlencode(query);
                }
            }
        } else if (api === 'private') {
            path = "api" + "/" + path;
            const now = this.nonce();
            this.checkRequiredCredentials();
            let payload;
            if (method == 'GET') payload = method + "/" + path;
            else payload = method + "/" + path + this.json(query);

            let signature = this.hmac(payload, this.secret, 'sha256', 'base64');
            headers = {
                "x-access-key": this.apiKey,
                "x-access-sign": signature,
                "x-access-timestamp": now
            };
            url += this.implodeParams(path, params);
            if (method === 'GET') {
                if (Object.keys(query).length) {
                    url += '?' + this.urlencode(query);
                }
            } else if (Object.keys(query).length) {
                body = this.json(query);
            }
        }

        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async signIn(params = {}) {
        this.checkRequiredCredentials();
        const request = {
            'grant_type': 'client_credentials', // the only supported value
        };
        const response = await this.accountsPostToken(this.extend(request, params));
        //
        //     {
        //         access_token: '0ttDv/2hTTn3bLi8GP1gKaneiEQ6+0hOBenPrxNQt2s=',
        //         token_type: 'bearer',
        //         expires_in: 900
        //     }
        //
        const expiresIn = this.safeInteger(response, 'expires_in');
        const accessToken = this.safeString(response, 'access_token');
        this.options['accessToken'] = accessToken;
        this.options['expires'] = this.sum(this.milliseconds(), expiresIn * 1000);
        return response;
    }

    handleErrors(code, reason, url, method, headers, body, response, requestHeaders, requestBody) {
        if (response === undefined) {
            return; // fallback to default error handler
        }
        if ('errorCode' in response) {
            const errorCode = this.safeString(response, 'errorCode');
            const message = this.safeString(response, 'message');
            if (errorCode !== undefined) {
                const feedback = this.id + ' ' + body;
                this.throwExactlyMatchedException(this.exceptions['exact'], message, feedback);
                this.throwBroadlyMatchedException(this.exceptions['exact'], errorCode, feedback);
                throw new ExchangeError(feedback);
            }
        }
    }
};
