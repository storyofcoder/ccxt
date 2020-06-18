'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require('./base/Exchange');
const { ExchangeError, ArgumentsRequired, InvalidNonce, OrderNotFound, InvalidOrder, InsufficientFunds, AuthenticationError, DDoSProtection, NotSupported } = require('./base/errors');
const { redisRead, redisWrite } = require('../../../lib/utils');

//  ---------------------------------------------------------------------------

module.exports = class liquid extends Exchange {
    describe() {
        return this.deepExtend(super.describe(), {
            'id': 'liquid',
            'name': 'Liquid',
            'countries': ['JP', 'CN', 'TW'],
            'version': '2',
            'rateLimit': 1000,
            'has': {
                'CORS': false,
                'fetchCurrencies': true,
                'fetchTickers': true,
                'fetchOrder': true,
                'fetchOrders': true,
                'fetchOpenOrders': true,
                'fetchClosedOrders': true,
                'fetchMyTrades': true,
                'fetchOHLCV': true,
                'withdraw': true,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/45798859-1a872600-bcb4-11e8-8746-69291ce87b04.jpg',
                'api': 'https://api.liquid.com',
                'www': 'https://www.liquid.com',
                'doc': [
                    'https://developers.liquid.com',
                ],
                'fees': 'https://help.liquid.com/getting-started-with-liquid/the-platform/fee-structure',
                'referral': 'https://www.liquid.com?affiliate=SbzC62lt30976',
            },
            'api': {
                'public': {
                    'get': [
                        'currencies',
                        'products',
                        'products/{id}',
                        'products/{id}/price_levels',
                        'executions',
                        'ir_ladders/{currency}',
                        'products/{id}/ohlc',
                        'fees', // add fetchFees, fetchTradingFees, fetchFundingFees
                    ],
                },
                'private': {
                    'get': [
                        'accounts/balance',
                        'accounts/main_asset',
                        'accounts/{id}',
                        'accounts/{currency}/reserved_balance_details',
                        'crypto_accounts', // add fetchAccounts
                        'crypto_withdrawals', // add fetchWithdrawals
                        'executions/me',
                        'fiat_accounts', // add fetchAccounts
                        'fund_infos', // add fetchDeposits
                        'loan_bids',
                        'loans',
                        'orders',
                        'orders/{id}',
                        'orders/{id}/trades', // add fetchOrderTrades
                        'trades',
                        'trades/{id}/loans',
                        'trading_accounts',
                        'trading_accounts/{id}',
                        'transactions',
                        'withdrawals', // add fetchWithdrawals
                    ],
                    'post': [
                        'crypto_withdrawals',
                        'fund_infos',
                        'fiat_accounts',
                        'loan_bids',
                        'orders',
                        'withdrawals',
                    ],
                    'put': [
                        'crypto_withdrawal/{id}/cancel',
                        'loan_bids/{id}/close',
                        'loans/{id}',
                        'orders/{id}', // add editOrder
                        'orders/{id}/cancel',
                        'trades/{id}',
                        'trades/{id}/adjust_margin',
                        'trades/{id}/close',
                        'trades/close_all',
                        'trading_accounts/{id}',
                        'withdrawals/{id}/cancel',
                    ],
                },
            },
            'timeframes': {
                '1m': '60',
                '5m': '300',
                '15m': '900',
                '30m': '1800',
                '1h': '3600',
                '2h': '7200',
                '4h': '14400',
                '6h': '21600',
                '1d': '86400',
                '3d': '259200',
                '1w': '604800'
            },
            'skipJsonOnStatusCodes': [401],
            'exceptions': {
                'API rate limit exceeded. Please retry after 300s': DDoSProtection,
                'API Authentication failed': AuthenticationError,
                'Nonce is too small': InvalidNonce,
                'Order not found': OrderNotFound,
                'Can not update partially filled order': InvalidOrder,
                'Can not update non-live order': OrderNotFound,
                'not_enough_free_balance': InsufficientFunds,
                'must_be_positive': InvalidOrder,
                'less_than_order_size': InvalidOrder,
            },
            'commonCurrencies': {
                'WIN': 'WCOIN',
                'HOT': 'HOT Token',
            },
            'options': {
                'cancelOrderException': true,
            },
        });
    }

    async fetchCurrencies(params = {}) {
        const response = await this.publicGetCurrencies(params);
        //
        //     [
        //         {
        //             currency_type: 'fiat',
        //             currency: 'USD',
        //             symbol: '$',
        //             assets_precision: 2,
        //             quoting_precision: 5,
        //             minimum_withdrawal: '15.0',
        //             withdrawal_fee: 5,
        //             minimum_fee: null,
        //             minimum_order_quantity: null,
        //             display_precision: 2,
        //             depositable: true,
        //             withdrawable: true,
        //             discount_fee: 0.5,
        //         },
        //     ]
        //
        const result = {};
        for (let i = 0; i < response.length; i++) {
            const currency = response[i];
            const id = this.safeString(currency, 'currency');
            const code = this.safeCurrencyCode(id);
            const active = currency['depositable'] && currency['withdrawable'];
            const amountPrecision = this.safeInteger(currency, 'display_precision');
            const pricePrecision = this.safeInteger(currency, 'quoting_precision');
            const precision = Math.max(amountPrecision, pricePrecision);
            result[code] = {
                'id': id,
                'code': code,
                'info': currency,
                'name': code,
                'active': active,
                'fee': this.safeFloat(currency, 'withdrawal_fee'),
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': Math.pow(10, -amountPrecision),
                        'max': Math.pow(10, amountPrecision),
                    },
                    'price': {
                        'min': Math.pow(10, -pricePrecision),
                        'max': Math.pow(10, pricePrecision),
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'withdraw': {
                        'min': this.safeFloat(currency, 'minimum_withdrawal'),
                        'max': undefined,
                    },
                },
            };
        }
        return result;
    }

    async fetchMarkets(params = {}) {
        let cacheData = await redisRead(this.id + '|markets');
        if (cacheData) return cacheData;
        else {
            const spot = await this.publicGetProducts(params);
            //
            //     [
            //         {
            //             id: '7',
            //             product_type: 'CurrencyPair',
            //             code: 'CASH',
            //             name: ' CASH Trading',
            //             market_ask: 8865.79147,
            //             market_bid: 8853.95988,
            //             indicator: 1,
            //             currency: 'SGD',
            //             currency_pair_code: 'BTCSGD',
            //             symbol: 'S$',
            //             btc_minimum_withdraw: null,
            //             fiat_minimum_withdraw: null,
            //             pusher_channel: 'product_cash_btcsgd_7',
            //             taker_fee: 0,
            //             maker_fee: 0,
            //             low_market_bid: '8803.25579',
            //             high_market_ask: '8905.0',
            //             volume_24h: '15.85443468',
            //             last_price_24h: '8807.54625',
            //             last_traded_price: '8857.77206',
            //             last_traded_quantity: '0.00590974',
            //             quoted_currency: 'SGD',
            //             base_currency: 'BTC',
            //             disabled: false,
            //         },
            //     ]
            //
            const perpetual = await this.publicGetProducts({ 'perpetual': '1' });
            //
            //     [
            //         {
            //             "id": "603",
            //             "product_type": "Perpetual",
            //             "code": "CASH",
            //             "name": null,
            //             "market_ask": "1143900",
            //             "market_bid": "1143250",
            //             "currency": "JPY",
            //             "currency_pair_code": "P-BTCJPY",
            //             "pusher_channel": "product_cash_p-btcjpy_603",
            //             "taker_fee": "0.0",
            //             "maker_fee": "0.0",
            //             "low_market_bid": "1124450.0",
            //             "high_market_ask": "1151750.0",
            //             "volume_24h": "0.1756",
            //             "last_price_24h": "1129850.0",
            //             "last_traded_price": "1144700.0",
            //             "last_traded_quantity": "0.014",
            //             "quoted_currency": "JPY",
            //             "base_currency": "P-BTC",
            //             "tick_size": "50.0",
            //             "perpetual_enabled": true,
            //             "index_price": "1142636.03935",
            //             "mark_price": "1143522.18417",
            //             "funding_rate": "0.00033",
            //             "fair_price": "1143609.31009",
            //             "timestamp": "1581558659.195353100",
            //         },
            //     ]
            //
            const currencies = await this.fetchCurrencies();
            const currenciesByCode = this.indexBy(currencies, 'code');
            const result = [];
            const markets = this.arrayConcat(spot, perpetual);
            for (let i = 0; i < markets.length; i++) {
                const market = markets[i];
                const id = this.safeString(market, 'id');
                const baseId = this.safeString(market, 'base_currency');
                const quoteId = this.safeString(market, 'quoted_currency');
                const productType = this.safeString(market, 'product_type');
                let type = 'spot';
                let spot = true;
                let swap = false;
                if (productType === 'Perpetual') {
                    spot = false;
                    swap = true;
                    type = 'swap';
                }
                const base = this.safeCurrencyCode(baseId);
                const quote = this.safeCurrencyCode(quoteId);
                let symbol = undefined;
                if (swap) {
                    symbol = this.safeString(market, 'currency_pair_code');
                } else {
                    symbol = base + '/' + quote;
                }
                const maker = this.safeFloat(market, 'maker_fee');
                const taker = this.safeFloat(market, 'taker_fee');
                const disabled = this.safeValue(market, 'disabled', false);
                const active = !disabled;
                const baseCurrency = this.safeValue(currenciesByCode, base);
                const quoteCurrency = this.safeValue(currenciesByCode, quote);
                const precision = {
                    'amount': 8,
                    'price': 8,
                };
                let minAmount = undefined;
                if (baseCurrency !== undefined) {
                    minAmount = this.safeFloat(baseCurrency['info'], 'minimum_order_quantity');
                    // precision['amount'] = this.safeInteger (baseCurrency['info'], 'quoting_precision');
                }
                let minPrice = undefined;
                if (quoteCurrency !== undefined) {
                    precision['price'] = this.safeInteger(quoteCurrency['info'], 'quoting_precision');
                    minPrice = Math.pow(10, -precision['price']);
                }
                let minCost = undefined;
                if (minPrice !== undefined) {
                    if (minAmount !== undefined) {
                        minCost = minPrice * minAmount;
                    }
                }
                const limits = {
                    'amount': {
                        'min': minAmount,
                        'max': undefined,
                    },
                    'price': {
                        'min': minPrice,
                        'max': undefined,
                    },
                    'cost': {
                        'min': minCost,
                        'max': undefined,
                    },
                };
                result.push({
                    'id': id,
                    'symbol': symbol,
                    'base': base,
                    'quote': quote,
                    'baseId': baseId,
                    'quoteId': quoteId,
                    'type': type,
                    'spot': spot,
                    'swap': swap,
                    'maker': maker,
                    'taker': taker,
                    'limits': limits,
                    'precision': precision,
                    'active': active,
                    'info': market,
                });
            }
            // Storing markets in Redis
            await redisWrite(this.id + '|markets', result, false, 60 * 60);
            return result;
        }
    }

    async fetchBalance(params = {}) {
        await this.loadMarkets();
        let balances = await this.privateGetAccountsBalance(params);
        let result = { 'info': balances };

        let promise = [];
        for (let i = 0; i < balances.length; i++)
            if (balances[i].balance > 0)
                promise.push(this.privateGetAccountsId(this.extend({
                    'id': balances[i].currency,
                }, params)))

        let res = await Promise.all(promise);
        let allCurrencyBalances = {};
        for (let i = 0; i < res.length; i++)
            allCurrencyBalances[res[i].currency] = res[i];

        for (let b = 0; b < balances.length; b++) {
            let balance = balances[b];
            let currencyId = balance['currency'];
            let code = currencyId;
            if (currencyId in this.currencies_by_id) {
                code = this.currencies_by_id[currencyId]['code'];
            }
            let total = parseFloat(balance['balance']);
            let account = {
                'free': allCurrencyBalances[currencyId] ? Number(allCurrencyBalances[currencyId].free_balance) : total,
                'used': allCurrencyBalances[currencyId] ? Number(allCurrencyBalances[currencyId].reserved_balance) : undefined,
                'total': allCurrencyBalances[currencyId] ? Number(allCurrencyBalances[currencyId].balance) : total,
            };
            result[code] = account;
        }
        return this.parseBalance(result);
    }

    async fetchOrderBook(symbol, limit = undefined, params = {}) {
        await this.loadMarkets();
        let orderbook = await this.publicGetProductsIdPriceLevels(this.extend({
            'id': this.marketId(symbol),
        }, params));
        return this.parseOrderBook(orderbook, undefined, 'buy_price_levels', 'sell_price_levels');
    }

    parseTicker(ticker, market = undefined) {
        const timestamp = this.milliseconds();
        let last = undefined;
        if ('last_traded_price' in ticker) {
            if (ticker['last_traded_price']) {
                const length = ticker['last_traded_price'].length;
                if (length > 0) {
                    last = this.safeFloat(ticker, 'last_traded_price');
                }
            }
        }
        let symbol = undefined;
        if (market === undefined) {
            const marketId = this.safeString(ticker, 'id');
            if (marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId];
            } else {
                const baseId = this.safeString(ticker, 'base_currency');
                const quoteId = this.safeString(ticker, 'quoted_currency');
                if (symbol in this.markets) {
                    market = this.markets[symbol];
                } else {
                    symbol = this.safeCurrencyCode(baseId) + '/' + this.safeCurrencyCode(quoteId);
                }
            }
        }
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        let change = undefined;
        let percentage = undefined;
        let average = undefined;
        const open = this.safeFloat(ticker, 'last_price_24h');
        if (open !== undefined && last !== undefined) {
            change = last - open;
            average = this.sum(last, open) / 2;
            if (open > 0) {
                percentage = change / open * 100;
            }
        }
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'high': this.safeFloat(ticker, 'high_market_ask'),
            'low': this.safeFloat(ticker, 'low_market_bid'),
            'bid': this.safeFloat(ticker, 'market_bid'),
            'bidVolume': undefined,
            'ask': this.safeFloat(ticker, 'market_ask'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': open,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': change,
            'percentage': percentage,
            'average': average,
            'baseVolume': this.safeFloat(ticker, 'volume_24h'),
            'quoteVolume': undefined,
            'info': ticker,
        };
    }

    async fetchTickers(symbols = undefined, params = {}) {
        await this.loadMarkets();
        const response = await this.publicGetProducts(params);
        const result = {};
        for (let i = 0; i < response.length; i++) {
            const ticker = this.parseTicker(response[i]);
            const symbol = ticker['symbol'];
            result[symbol] = ticker;
        }
        return result;
    }

    async fetchTicker(symbol, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        const request = {
            'id': market['id'],
        };
        const response = await this.publicGetProductsId(this.extend(request, params));
        return this.parseTicker(response, market);
    }

    parseTrade(trade, market = undefined) {
        // {             id:  12345,
        //         quantity: "6.789",
        //            price: "98765.4321",
        //       taker_side: "sell",
        //       created_at:  1512345678,
        //          my_side: "buy"           }
        const timestamp = this.safeTimestamp(trade, 'created_at');
        const orderId = this.safeString(trade, 'order_id');
        // 'taker_side' gets filled for both fetchTrades and fetchMyTrades
        const takerSide = this.safeString(trade, 'taker_side');
        // 'my_side' gets filled for fetchMyTrades only and may differ from 'taker_side'
        const mySide = this.safeString(trade, 'my_side');
        const side = (mySide !== undefined) ? mySide : takerSide;
        let takerOrMaker = undefined;
        if (mySide !== undefined) {
            takerOrMaker = (takerSide === mySide) ? 'taker' : 'maker';
        }
        let cost = undefined;
        const price = this.safeFloat(trade, 'price');
        const amount = this.safeFloat(trade, 'quantity');
        if (price !== undefined) {
            if (amount !== undefined) {
                cost = price * amount;
            }
        }
        const id = this.safeString(trade, 'id');
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        return {
            'info': trade,
            'id': id,
            'order': orderId,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'symbol': symbol,
            'type': undefined,
            'side': side,
            'takerOrMaker': takerOrMaker,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': undefined,
        };
    }

    async fetchTrades(symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        const request = {
            'product_id': market['id'],
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        if (since !== undefined) {
            // timestamp should be in seconds, whereas we use milliseconds in since and everywhere
            request['timestamp'] = parseInt(since / 1000);
        }
        const response = await this.publicGetExecutions(this.extend(request, params));
        const result = (since !== undefined) ? response : response['models'];
        return this.parseTrades(result, market, since, limit);
    }

    async fetchMyTrades(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        // the `with_details` param is undocumented - it adds the order_id to the results
        const request = {
            'product_id': market['id'],
            'with_details': true,
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privateGetExecutionsMe(this.extend(request, params));
        return this.parseTrades(response['models'], market, since, limit);
    }

    async createOrder(symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets();
        const clientOrderId = this.safeString2(params, 'clientOrderId', 'client_order_id');
        params = this.omit(params, ['clientOrderId', 'client_order_id']);
        if (type == "stop_limit") type = "stop";
        const request = {
            'order_type': type,
            'product_id': this.marketId(symbol),
            'side': side,
            'quantity': this.amountToPrecision(symbol, amount),
        };
        if (clientOrderId !== undefined) {
            request['client_order_id'] = clientOrderId;
        }
        if ((type === 'limit') || (type === 'limit_post_only') || (type === 'market_with_range') || (type === 'stop')) {
            request['price'] = this.priceToPrecision(symbol, price);
        }
        const response = await this.privatePostOrders(this.extend(request, params));
        //
        //     {
        //         "id": 2157474,
        //         "order_type": "limit",
        //         "quantity": "0.01",
        //         "disc_quantity": "0.0",
        //         "iceberg_total_quantity": "0.0",
        //         "side": "sell",
        //         "filled_quantity": "0.0",
        //         "price": "500.0",
        //         "created_at": 1462123639,
        //         "updated_at": 1462123639,
        //         "status": "live",
        //         "leverage_level": 1,
        //         "source_exchange": "QUOINE",
        //         "product_id": 1,
        //         "product_code": "CASH",
        //         "funding_currency": "USD",
        //         "currency_pair_code": "BTCUSD",
        //         "order_fee": "0.0",
        //         "client_order_id": null,
        //     }
        //
        return this.parseOrder(response);
    }

    async cancelOrder(id, symbol = undefined, params = {}) {
        await this.loadMarkets();
        const request = {
            'id': id,
        };
        const response = await this.privatePutOrdersIdCancel(this.extend(request, params));
        const order = this.parseOrder(response);
        if (order['status'] === 'closed') {
            if (this.options['cancelOrderException']) {
                throw new OrderNotFound(this.id + ' order closed already: ' + this.json(response));
            }
        }
        return order;
    }

    async editOrder(id, symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets();
        if (price === undefined) {
            throw new ArgumentsRequired(this.id + ' editOrder requires the price argument');
        }
        const request = {
            'order': {
                'quantity': this.amountToPrecision(symbol, amount),
                'price': this.priceToPrecision(symbol, price),
            },
            'id': id,
        };
        const response = await this.privatePutOrdersId(this.extend(request, params));
        return this.parseOrder(response);
    }

    parseOrderStatus(status) {
        const statuses = {
            'live': 'open',
            'filled': 'closed',
            'cancelled': 'canceled',
        };
        return this.safeString(statuses, status, status);
    }

    parseOrder(order, market = undefined) {
        //
        // createOrder
        //
        //     {
        //         "id": 2157474,
        //         "order_type": "limit",
        //         "quantity": "0.01",
        //         "disc_quantity": "0.0",
        //         "iceberg_total_quantity": "0.0",
        //         "side": "sell",
        //         "filled_quantity": "0.0",
        //         "price": "500.0",
        //         "created_at": 1462123639,
        //         "updated_at": 1462123639,
        //         "status": "live",
        //         "leverage_level": 1,
        //         "source_exchange": "QUOINE",
        //         "product_id": 1,
        //         "product_code": "CASH",
        //         "funding_currency": "USD",
        //         "currency_pair_code": "BTCUSD",
        //         "order_fee": "0.0"
        //         "client_order_id": null,
        //     }
        //
        // fetchOrder, fetchOrders, fetchOpenOrders, fetchClosedOrders
        //
        //     {
        //         "id": 2157479,
        //         "order_type": "limit",
        //         "quantity": "0.01",
        //         "disc_quantity": "0.0",
        //         "iceberg_total_quantity": "0.0",
        //         "side": "sell",
        //         "filled_quantity": "0.01",
        //         "price": "500.0",
        //         "created_at": 1462123639,
        //         "updated_at": 1462123639,
        //         "status": "filled",
        //         "leverage_level": 2,
        //         "source_exchange": "QUOINE",
        //         "product_id": 1,
        //         "product_code": "CASH",
        //         "funding_currency": "USD",
        //         "currency_pair_code": "BTCUSD",
        //         "order_fee": "0.0",
        //         "executions": [
        //             {
        //                 "id": 4566133,
        //                 "quantity": "0.01",
        //                 "price": "500.0",
        //                 "taker_side": "buy",
        //                 "my_side": "sell",
        //                 "created_at": 1465396785
        //             }
        //         ]
        //     }
        //
        const orderId = this.safeString(order, 'id');
        const timestamp = this.safeTimestamp(order, 'created_at');
        const marketId = this.safeString(order, 'product_id');
        market = this.safeValue(this.markets_by_id, marketId);
        const status = this.parseOrderStatus(this.safeString(order, 'status'));
        const amount = this.safeFloat(order, 'quantity');
        let filled = this.safeFloat(order, 'filled_quantity');
        const price = this.safeFloat(order, 'price');
        let symbol = undefined;
        let feeCurrency = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
            feeCurrency = market['quote'];
        }
        const type = this.safeString(order, 'order_type');
        let tradeCost = 0;
        let tradeFilled = 0;
        let average = this.safeFloat(order, 'average_price');
        const trades = this.parseTrades(this.safeValue(order, 'executions', []), market, undefined, undefined, {
            'order': orderId,
            'type': type,
        });
        const numTrades = trades.length;
        for (let i = 0; i < numTrades; i++) {
            // php copies values upon assignment, but not references them
            // todo rewrite this (shortly)
            const trade = trades[i];
            trade['order'] = orderId;
            trade['type'] = type;
            tradeFilled = this.sum(tradeFilled, trade['amount']);
            tradeCost = this.sum(tradeCost, trade['cost']);
        }
        let cost = undefined;
        let lastTradeTimestamp = undefined;
        if (numTrades > 0) {
            lastTradeTimestamp = trades[numTrades - 1]['timestamp'];
            if (!average && (tradeFilled > 0)) {
                average = tradeCost / tradeFilled;
            }
            if (cost === undefined) {
                cost = tradeCost;
            }
            if (filled === undefined) {
                filled = tradeFilled;
            }
        }
        let remaining = undefined;
        if (amount !== undefined && filled !== undefined) {
            remaining = amount - filled;
        }
        const side = this.safeString(order, 'side');
        const clientOrderId = this.safeString(order, 'client_order_id');
        return {
            'id': orderId,
            'clientOrderId': clientOrderId,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'type': type,
            'status': status,
            'symbol': symbol,
            'side': side,
            'price': price,
            'amount': amount,
            'filled': filled,
            'cost': cost,
            'remaining': remaining,
            'average': average,
            'trades': trades,
            'fee': {
                'currency': feeCurrency,
                'cost': this.safeFloat(order, 'order_fee'),
            },
            'info': order,
        };
    }

    async fetchOrder(id, symbol = undefined, params = {}) {
        await this.loadMarkets();
        const request = {
            'id': id,
        };
        const response = await this.privateGetOrdersId(this.extend(request, params));
        return this.parseOrder(response);
    }

    async fetchOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        let market = undefined;
        const request = {
            // 'funding_currency': market['quoteId'], // filter orders based on "funding" currency (quote currency)
            // 'product_id': market['id'],
            // 'status': 'live', // 'filled', 'cancelled'
            // 'trading_type': 'spot', // 'margin', 'cfd'
            'with_details': 1, // return full order details including executions
        };
        if (symbol !== undefined) {
            market = this.market(symbol);
            request['product_id'] = market['id'];
        }
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privateGetOrders(this.extend(request, params));
        //
        //     {
        //         "models": [
        //             {
        //                 "id": 2157474,
        //                 "order_type": "limit",
        //                 "quantity": "0.01",
        //                 "disc_quantity": "0.0",
        //                 "iceberg_total_quantity": "0.0",
        //                 "side": "sell",
        //                 "filled_quantity": "0.0",
        //                 "price": "500.0",
        //                 "created_at": 1462123639,
        //                 "updated_at": 1462123639,
        //                 "status": "live",
        //                 "leverage_level": 1,
        //                 "source_exchange": "QUOINE",
        //                 "product_id": 1,
        //                 "product_code": "CASH",
        //                 "funding_currency": "USD",
        //                 "currency_pair_code": "BTCUSD",
        //                 "order_fee": "0.0",
        //                 "executions": [], // optional
        //             }
        //         ],
        //         "current_page": 1,
        //         "total_pages": 1
        //     }
        //
        const orders = this.safeValue(response, 'models', []);
        return this.parseOrders(orders, market, since, limit);
    }

    async fetchOpenOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = { 'status': 'live' };
        return await this.fetchOrders(symbol, since, limit, this.extend(request, params));
    }

    async fetchClosedOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const request = { 'status': 'filled' };
        return await this.fetchOrders(symbol, since, limit, this.extend(request, params));
    }

    parseOHLCVs(ohlcvs, market, timeframe, since, limit) {
        ohlcvs = Object.values(ohlcvs || [])
        let result = []
        for (let i = 0; i < ohlcvs.length; i++) {
            if (limit && (result.length >= limit))
                break;
            let ohlcv = this.parseOHLCV(ohlcvs[i], market, timeframe, since, limit)
            ohlcv[0] = ohlcv[0] * 1000;
            if (since && (ohlcv[0] < since))
                continue
            result.push(ohlcv)
        }
        return this.sortBy(result, 0);
    }

    async fetchOHLCV(symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        const marketId = market['id'];
        const request = {
            'id': marketId,
            'resolution': this.timeframes[timeframe]
        };
        const response = await this.publicGetProductsIdOhlc(this.extend(request, params));
        const responseData = response['data'];
        return this.parseOHLCVs(responseData, market, timeframe, since, limit);
    }

    async withdraw(code, amount, address, tag = undefined, params = {}) {
        this.checkAddress(address);
        await this.loadMarkets();
        const currency = this.currency(code);
        const request = {
            // 'auth_code': '', // optional 2fa code
            'currency': currency['id'],
            'address': address,
            'amount': this.currencyToPrecision(code, amount),
            // 'payment_id': tag, // for XRP only
            // 'memo_type': 'text', // 'text', 'id' or 'hash', for XLM only
            // 'memo_value': tag, // for XLM only
        };
        if (tag !== undefined) {
            if (code === 'XRP') {
                request['payment_id'] = tag;
            } else if (code === 'XLM') {
                request['memo_type'] = 'text'; // overrideable via params
                request['memo_value'] = tag;
            } else {
                throw new NotSupported(this.id + ' withdraw() only supports a tag along the address for XRP or XLM');
            }
        }
        const response = await this.privatePostCryptoWithdrawals(this.extend(request, params));
        //
        //     {
        //         "id": 1353,
        //         "address": "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
        //         "amount": 1.0,
        //         "state": "pending",
        //         "currency": "BTC",
        //         "withdrawal_fee": 0.0,
        //         "created_at": 1568016450,
        //         "updated_at": 1568016450,
        //         "payment_id": null
        //     }
        //
        return this.parseTransaction(response, currency);
    }

    parseTransactionStatus(status) {
        const statuses = {
            'pending': 'pending',
            'cancelled': 'canceled',
            'approved': 'ok',
        };
        return this.safeString(statuses, status, status);
    }

    parseTransaction(transaction, currency = undefined) {
        //
        // withdraw
        //
        //     {
        //         "id": 1353,
        //         "address": "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
        //         "amount": 1.0,
        //         "state": "pending",
        //         "currency": "BTC",
        //         "withdrawal_fee": 0.0,
        //         "created_at": 1568016450,
        //         "updated_at": 1568016450,
        //         "payment_id": null
        //     }
        //
        // fetchDeposits, fetchWithdrawals
        //
        //     ...
        //
        const id = this.safeString(transaction, 'id');
        const address = this.safeString(transaction, 'address');
        const tag = this.safeString2(transaction, 'payment_id', 'memo_value');
        const txid = undefined;
        const currencyId = this.safeString(transaction, 'asset');
        const code = this.safeCurrencyCode(currencyId, currency);
        const timestamp = this.safeTimestamp(transaction, 'created_at');
        const updated = this.safeTimestamp(transaction, 'updated_at');
        const type = 'withdrawal';
        const status = this.parseTransactionStatus(this.safeString(transaction, 'state'));
        const amount = this.safeFloat(transaction, 'amount');
        return {
            'info': transaction,
            'id': id,
            'txid': txid,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'address': address,
            'tag': tag,
            'type': type,
            'amount': amount,
            'currency': code,
            'status': status,
            'updated': updated,
            'fee': undefined,
        };
    }

    nonce() {
        return this.milliseconds();
    }

    sign(path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = '/' + this.implodeParams(path, params);
        const query = this.omit(params, this.extractParams(path));
        headers = {
            'X-Quoine-API-Version': this.version,
            'Content-Type': 'application/json',
        };
        if (api === 'private') {
            this.checkRequiredCredentials();
            if (method === 'GET') {
                if (Object.keys(query).length) {
                    url += '?' + this.urlencode(query);
                }
            } else if (Object.keys(query).length) {
                body = this.json(query);
            }
            const nonce = this.nonce();
            const request = {
                'path': url,
                'token_id': this.apiKey,
                'iat': Math.floor(nonce / 1000), // issued at
            };
            if (!('client_order_id' in query)) {
                request['nonce'] = nonce;
            }
            headers['X-Quoine-Auth'] = this.jwt(request, this.encode(this.secret));
        } else {
            if (Object.keys(query).length) {
                url += '?' + this.urlencode(query);
            }
        }
        url = this.urls['api'] + url;
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors(code, reason, url, method, headers, body, response, requestHeaders, requestBody) {
        if (code >= 200 && code < 300) {
            return;
        }
        if (code === 401) {
            // expected non-json response
            this.throwExactlyMatchedException(this.exceptions, body, body);
            return;
        }
        if (code === 429) {
            throw new DDoSProtection(this.id + ' ' + body);
        }
        if (response === undefined) {
            return;
        }
        const feedback = this.id + ' ' + body;
        const message = this.safeString(response, 'message');
        const errors = this.safeValue(response, 'errors');
        if (message !== undefined) {
            //
            //  { "message": "Order not found" }
            //
            this.throwExactlyMatchedException(this.exceptions, message, feedback);
        } else if (errors !== undefined) {
            //
            //  { "errors": { "user": ["not_enough_free_balance"] }}
            //  { "errors": { "quantity": ["less_than_order_size"] }}
            //  { "errors": { "order": ["Can not update partially filled order"] }}
            //
            const types = Object.keys(errors);
            for (let i = 0; i < types.length; i++) {
                const type = types[i];
                const errorMessages = errors[type];
                for (let j = 0; j < errorMessages.length; j++) {
                    const message = errorMessages[j];
                    this.throwExactlyMatchedException(this.exceptions, message, feedback);
                }
            }
        } else {
            throw new ExchangeError(feedback);
        }
    }
};