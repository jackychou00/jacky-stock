IndustryCollection = new Mongo.Collection('industry');
StockCollection = new Mongo.Collection('stock');
StockLastPriceCollection = new Mongo.Collection('stockLastPrice');
TseT00PriceCollection = new Mongo.Collection('tseT00Price');
if (Meteor.isClient) {

    var app = angular.module('StockApp', ['angular-meteor']);

    app.controller("StockCtrl", ['$scope', '$meteor', '$interval', function ($scope, $meteor, $interval) {
        $scope.$meteorSubscribe('stocks');
        $scope.stocksInSearch = $meteor.collection(function () {
            return StockCollection.find($scope.getReactively('keywordQuery'), {sort: {ch: 1}});
        });
        $scope.$watch('searchStockKeyword', function () {
            if ($scope.searchStockKeyword && $scope.searchStockKeyword.length > 0) {
                $scope.keywordQuery =
                {
                    $or: [
                        {ch: {$regex: new RegExp("^" + $scope.searchStockKeyword)}},
                        {n: {$regex: new RegExp($scope.searchStockKeyword)}}
                    ]
                }
            }
        });
        $scope.subscribeStocks = []
        Meteor.subscribe('user');

        if(Meteor.userId()){
            Meteor.call('getUserStock',Meteor.userId(),function(err, response) {
                response.forEach(function(stock){
                    result = StockCollection.findOne({ch:stock});
                    $scope.subscribeStocks.push(result)
                })
            });
            
        }
        
        
        $scope.addToSubscribe = function (ch) {
            
            //如果有登入,加入帳戶資料
            if(Meteor.userId()){
                Meteor.call('setUserStock',ch,function(err, response) {
                    
                });

            }
            $scope.subscribeStocks.push(ch)
            $scope.refreshSubscribeStocks();
        }
        $scope.isSubscribed = function (stock) {
            console.log(stock)
            console.log($scope.subscribeStocks)
            console.log(_.contains($scope.subscribeStocks, stock))
            var chs = $scope.subscribeStocks.map(function(stock){return stock.ch});
            return _.contains(chs, stock.ch);
        }
        $scope.unsubscribe = function (stock,index) {
            $scope.subscribeStocks = _.without($scope.subscribeStocks, stock);

            Meteor.call('unsetUserStock',Meteor.userId(),index,function(err, response) {
                    
            });
            
        }
        $scope.$meteorSubscribe('StockLastPrice');
        var getLastPriceInfo = function (ch) {
            
            var info = StockLastPriceCollection.findOne({stockId: ch}).info;
            return {
                lastPrice: info.l_cur.replace("NT$", ""),
                y: info.pcls_fix,
                diff: info.c,
                diffRange: info.cp
            };
        }



        $scope.refreshSubscribeStocks = function () {
            
            
            $scope.subscribeStocks.forEach(function (stock) {
                stock.priceInfo = getLastPriceInfo(stock.ch);
            });
            
        }
        $interval($scope.refreshSubscribeStocks, 2500);

        $scope.$meteorSubscribe('test00');
        refreshTseT00 = function () {
            TseT00PriceCollection.find({}).forEach(function(e){
                $scope.tseT00 = e;   
            })
            
        }
        refreshTseT00();
        $interval(refreshTseT00, 2500);

        $scope.getPriceCss = function (stockPrice) {
            if (stockPrice) {
                var diff = (stockPrice.y - stockPrice.lastPrice).toFixed(2)
                if (diff < 0) {
                    return "price-up";
                } else if (diff == 0) {
                    return "price-no";
                } else {
                    return "price-down";
                }
            }
        }
        $scope.getPriceDiff = function (stockPrice) {
            if (stockPrice) {
                var diff = (stockPrice.lastPrice - stockPrice.y);
                diff = diff.toFixed(2);
                if (diff > 0) {
                    diff = "+" + diff
                }
                return diff;
            }
        }


    }]);

    Accounts.ui.config({
        passwordSignupFields: "USERNAME_ONLY"
    });

}

if (Meteor.isServer) {
    Meteor.startup(function () {

            Meteor.http.get("http://mis.twse.com.tw/stock/api/getIndustry.jsp", function (err, response) {
                var resObj = JSON.parse(response.content);
                _.forEach(resObj.tse, function (e) {
                    var industry = IndustryCollection.findOne({market: 'tse', code: e.code});
                    if (industry == undefined) {
                        e.market = 'tse';
                        IndustryCollection.insert(e);
                    }

                })
                //_.forEach(resObj.otc, function (e) {
                //    var industry = IndustryCollection.findOne({market: 'otc', code: e.code});
                //    if (industry == undefined) {
                //        e.market = 'otc';
                //        IndustryCollection.insert(e);
                //    }
                //})

                IndustryCollection.find({}).forEach(function (industry) {
                    Meteor.http.get("http://mis.twse.com.tw/stock/api/getCategory.jsp?ex=" + industry.market + "&i=" + industry.code, function (e, res) {
                        var stocks = JSON.parse(res.content).msgArray;
                        stocks = _.filter(stocks, function (stock) {
                            if (stock.ch.length > 7) {
                                return false;
                            }
                            return true;
                        });
                        stocks = _.map(stocks, function (stock) {
                            stock.ch = stock.ch.replace(".tw", "");
                            return stock;
                        });

                        var chs = _.map(stocks, function (stock) {
                            return stock.ch;
                        });

                        IndustryCollection.update({market: industry.market, code: industry.code}, {
                            $set: {stocks: chs}
                        });
                        _.forEach(stocks, function (stock) {
                            var stockInDb = StockCollection.findOne({ch: stock.ch});
                            if (stockInDb == undefined) {
                                StockCollection.insert(stock);
                            }
                        });
                    });
                })
            });


            Meteor.setInterval(function () {
                IndustryCollection.find({}).forEach(function (industry) {
                    var chs = _.map(industry.stocks, function (stock) {
                        return "TPE:" + stock;
                    });
                    if (chs.length > 0) {
                        var chsAsString = _.reduce(chs, function (s1, s2) {
                            return s1 + "," + s2;
                        });
                        Meteor.http.get("http://finance.google.com/finance/info?client=ig&q=" + chsAsString, function (err, res) {
                            var stockLastPrices = JSON.parse(res.content.replace("//", ""));
                            _.each(stockLastPrices, function (lastPrice) {
                                var lastPriceInDb = StockLastPriceCollection.findOne({stockId: lastPrice.t});
                                if (lastPriceInDb == undefined) {
                                    StockLastPriceCollection.insert({
                                        stockId: lastPrice.t,
                                        info: lastPrice
                                    });
                                } else {
                                    StockLastPriceCollection.update({stockId: lastPrice.t}, {$set: {info: lastPrice}})
                                }
                            });

                        })
                    }


                });
            }, 5000);

            Meteor.setInterval(function () {
                Meteor.http.get("http://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0", function (err, res) {
                    var priceRecord = JSON.parse(res.content).msgArray[0];
                    var date = new Date(parseInt(priceRecord.tlong));
                    var find = TseT00PriceCollection.findOne({tlong: priceRecord.tlong});
                    if (find == undefined) {
                        TseT00PriceCollection.insert({
                            lastTradeCount: priceRecord.tv,
                            totalTradeCount: priceRecord.v,
                            lastTradeTimestamp: (date.getUTCHours() + 8) + ":" + date.getUTCMinutes() + ":" + date.getUTCSeconds(),
                            tlong: priceRecord.tlong,
                            lastPrice: parseFloat(priceRecord.z),
                            y: parseFloat(priceRecord.y)
                        });
                    }

                });
            }, 3000);


        }
    )
    ;
    Meteor.methods({
        setUserStock: function (stock) {
        Meteor.users.update(
            { _id: Meteor.userId() },
            {
            $push: { 
                stocks:stock.ch
            }
        });
                
      
      },
      getUserStock: function (userId){
         result = Meteor.users.findOne({ _id: userId});
         return result.stocks
      },
      unsetUserStock: function (userId,index){
        var stock = {}
        stock["stocks."+index] = 1
        Meteor.users.update({_id: userId},{$unset:stock});
        Meteor.users.update({_id: userId},{$pull:{"stocks":null}});
      }

      
    });

    

    Meteor.publish("test00", function(){
        var result  = TseT00PriceCollection.find({}, {limit: 1, sort: {tlong: -1}});
        return result;
    })

    Meteor.publish("stocks",function(){
        return StockCollection.find({});
        
        //return result1;
    })
    Meteor.publish("StockLastPrice",function(){
        return StockLastPriceCollection.find({});
    })
}
