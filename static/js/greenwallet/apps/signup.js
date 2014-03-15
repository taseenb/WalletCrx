var SignupControllerAsync = (function() {
var signup = {};  // bleh (see comment below)
return ['$scope', '$location', 'mnemonics', 'tx_sender', 'notices', 'wallets', '$window', 'facebook', '$modal', 'gaEvent', '$q', 'reddit',
        function SignupController($scope, $location, mnemonics, tx_sender, notices, wallets, $window, facebook, $modal, gaEvent, $q, reddit) {
    // some Android devices have window.WebSocket defined and yet still don't support WebSockets
    var isUnsupportedAndroid = navigator.userAgent.match(/Android 4.0/i) ||
                               navigator.userAgent.match(/Android 4.1/i) ||
                               navigator.userAgent.match(/Android 4.2/i) ||
                               navigator.userAgent.match(/Android 4.3/i);
    var isChrome = navigator.userAgent.match(/Chrome/i);
    if (!window.cordova && (!window.WebSocket || !window.Worker || (isUnsupportedAndroid && !isChrome))) {
        $location.path('/browser_unsupported');
        return;
    }
    var requires_mnemonic = ($location.path() == '/signup_pin' || $location.path() == '/signup_oauth' || $location.path() == '/signup_2factor');
    if (requires_mnemonic && !signup.mnemonic) {
        $location.path('/create');
        return;
    }
    if (!$scope.wallet.signup) {  // clear for case of other signup done previously in the same browser/crx session
        for (k in signup) {
            signup[k] = undefined;
        }
    }
    $scope.signup = signup;
    $scope.$digest();  // not sure why is this necessary, but i'm already too annoyed with this JS to find out...
    $scope.wallet.hidden = true;
    $scope.wallet.signup = true;

    var secured_confirmed = $q.defer();

    if (signup.fbloginstate === undefined) {
        signup.fbloginstate = {};
        signup.redditloginstate = {}        
        signup.seed_progress = 0;
        var rng = new SecureRandom();
        var entropy = Bitcoin.ECDSA.getBigRandom(secp256k1().n, rng).toByteArrayUnsigned();
        var hdwallet;
    
        mnemonics.toMnemonic(entropy).then(function(mnemonic) {
            $scope.wallet.mnemonic = $scope.signup.mnemonic = mnemonic;
            mnemonics.toSeed(mnemonic).then(function(seed) {
                $scope.signup.seed = seed;
                hdwallet = new GAHDWallet({seed_hex: seed});
                var master_public = Crypto.util.bytesToHex(hdwallet.public_key.getEncoded(true));
                var master_chaincode = hdwallet.chain_code_hex;
                secured_confirmed.promise.then(function() {
                    tx_sender.call('http://greenaddressit.com/login/register',
                        master_public, master_chaincode).then(function(data) {
                            wallets.login($scope, hdwallet, mnemonic, true).then(function(data) {
                                gaEvent('Signup', 'LoggedIn');
                                if ($scope.wallet.signup_fb_prelogged_in) {
                                    $scope.signup.fblogin();
                                }
                                if ($scope.wallet.signup_reddit_prelogged_in) {
                                    $scope.signup.redditlogin($scope.wallet.signup_reddit_prelogged_in);
                                }
                                $scope.signup.logged_in = data;
                                if (!data) $scope.signup.login_failed = true;
                            });
                        });
                });
            }, null, function(progress) {
                $scope.signup.seed_progress = progress;
            });
        });
    }

    var secured_confirmed_resolved = false;
    $scope.$watch('signup.secured_confirmed', function(newValue, oldValue) {
        if (newValue == oldValue) return;
        if (newValue && !secured_confirmed_resolved) { 
            secured_confirmed.resolve(true);
            secured_confirmed_resolved = true;
        }
    });

    $scope.signup.set_pin = function() {
        if (!$scope.signup.pin) {
            gaEvent('Signup', 'PinSkippedToOauth');
            $location.url('/signup_oauth#content_container');
            return;
        }
        $scope.signup.setting_pin = true;
        wallets.create_pin($scope.signup.pin.toString(), $scope.signup.seed, $scope.signup.mnemonic).then(function() {
            gaEvent('Signup', 'PinSet');
            $scope.signup.pin_set = true;
            $scope.signup.setting_pin = false;
            $location.url('/signup_oauth');
        }, function(failure) {
            gaEvent('Signup', 'PinSettingFailed', failure);
            notices.makeNotice('error', 'Failed setting PIN.' + (failure ? ' ' + failure : ''));
            $scope.signup.setting_pin = false;
        });

    };

    $scope.signup.fblogin = function() {
        gaEvent('Signup', 'FbLoginClicked');
        facebook.login($scope.signup.fbloginstate).then(function() {
            var auth = FB.getAuthResponse();
            $scope.signup.social_in_progress = true;
            tx_sender.call('http://greenaddressit.com/addressbook/sync_fb', auth.accessToken).then(function() {
                gaEvent('Signup', 'FbSyncEnabled');
                $scope.signup.social_in_progress = false;
                $scope.signup.any_social_done = true;
                $scope.signup.fbloginstate.synchronized = true;
            }, function(err) {
                gaEvent('Signup', 'FbSyncFailed', err.desc);
                notices.makeNotice('error', err.desc);
                $scope.signup.social_in_progress = false;
                $scope.signup.fbloginstate.logged_in = false;
            });
        });
    };

    $scope.signup.redditlogin = function(token) {
        gaEvent('Signup', 'RedditLoginClicked');
        if (token) {
            var d = $q.when(token);
        } else {
            var d = reddit.getToken('identity');
        }
        d.then(function(token) {
            if (token) {
                $scope.signup.social_in_progress = true;
                tx_sender.call('http://greenaddressit.com/addressbook/sync_reddit', token).then(function() {
                    gaEvent('Signup', 'RedditSyncEnabled');
                    $scope.signup.social_in_progress = false;
                    $scope.signup.any_social_done = true;
                    $scope.signup.redditloginstate.synchronized = true;
                }, function(err) {
                    gaEvent('Signup', 'RedditSyncEnableFailed');
                    notices.makeNotice('error', err.desc);
                    $scope.signup.social_in_progress = false;
                    that.toggling_reddit = false;
                });
            }
        });
    };

    $scope.signup.qrmodal = function() {
        gaEvent('Signup', 'QrModal');
        $modal.open({
            templateUrl: '/'+LANG+'/wallet/partials/signup_qr_modal.html',
            scope: $scope
        });
    };
    
    $scope.signup.nfcmodal = function() {
        gaEvent('Signup', 'NfcModal');
        $modal.open({
            templateUrl: '/'+LANG+'/wallet/partials/signup_nfc_modal.html',
            scope: $scope,
            controller: 'NFCController'
        });
    };
}]})();
