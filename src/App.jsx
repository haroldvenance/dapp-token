import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import QRCode from 'qrcode.react';
import NftMarketplace from './components/NftMarketplace';

import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useAccount, useConnect, useDisconnect, useWalletClient, useSwitchChain, useChainId } from 'wagmi';

import { config } from './config';
import TokenArtifact from './contracts/SangoCoin.json';

const TOKEN_ADDRESS = '0x55E3AC18F352cd77A01612d7C595Cb5bE367FB97';
const ABI = TokenArtifact.abi;

// Marketplace constants
const MARKET_ADDRESS = '0xae1c6E5C3025E13E0bEd276a4a2Cd67c41CE4A28';
const MARKET_ABI = [
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Sale(uint256 indexed tokenId, address indexed buyer, uint256 price)",
  "event Cancelled(uint256 indexed tokenId)"
];

function walletClientToSigner(walletClient) {
  const { account, chain, transport } = walletClient;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new ethers.providers.Web3Provider(transport, network);
  return provider.getSigner(account.address);
}

const queryClient = new QueryClient();

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MainContent />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// ---- WalletConnector (inchangé) ----
function WalletConnector() {
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { address: account, isConnected } = useAccount();

  if (isConnected) {
    return (
      <div className="flex items-center justify-between bg-white/80 dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
        <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate">
          {account?.slice(0, 6)}...{account?.slice(-4)}
        </span>
        <button onClick={disconnect} className="text-red-500 text-xs font-medium hover:underline">
          Déconnecter
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => connect({ connector })}
          disabled={isPending}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-4 rounded-xl shadow transition-colors"
        >
          {connector.name === 'Injected'
            ? 'MetaMask (ou wallet navigateur)'
            : 'WalletConnect (QR code)'}
        </button>
      ))}
    </div>
  );
}

// ---- MainContent ----
function MainContent() {
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [balance, setBalance] = useState('0');
  const [isOwner, setIsOwner] = useState(false);

  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [copied, setCopied] = useState(false);

  const [sgcHistory, setSgcHistory] = useState([]);
  const [marketEvents, setMarketEvents] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(false);

  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  const [currentPage, setCurrentPage] = useState('home');

  const { address: account, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  // Initialisation du signer et du contrat
  useEffect(() => {
    if (!isConnected || !walletClient) {
      setSigner(null);
      setContract(null);
      return;
    }
    try {
      const ethersSigner = walletClientToSigner(walletClient);
      setSigner(ethersSigner);
    } catch (err) {
      console.error(err);
      toast.error('Erreur de connexion au wallet');
    }
  }, [isConnected, walletClient]);

  useEffect(() => {
    if (!isConnected || !signer) {
      setContract(null);
      setBalance('0');
      setIsOwner(false);
      return;
    }
    const contr = new ethers.Contract(TOKEN_ADDRESS, ABI, signer);
    setContract(contr);
    refreshBalanceAndOwner(contr);
  }, [isConnected, signer]);

  async function refreshBalanceAndOwner(contr) {
    try {
      const bal = await contr.balanceOf(account);
      setBalance(ethers.utils.formatUnits(bal, 18));
      const ownerAddr = await contr.owner();
      setIsOwner(account.toLowerCase() === ownerAddr.toLowerCase());
    } catch (err) {
      console.error(err);
      toast.error('Impossible de lire le solde. Vérifiez le réseau.');
    }
  }

  const refreshBalance = useCallback(async () => {
    if (!contract || !account) return;
    const bal = await contract.balanceOf(account);
    setBalance(ethers.utils.formatUnits(bal, 18));
  }, [contract, account]);

  const switchToSepolia = () => {
    if (switchChain) {
      switchChain({ chainId: 11155111 });
    } else {
      toast.error('Changement de réseau non supporté');
    }
  };

  const addTokenToMetaMask = async () => {
    if (!window.ethereum) {
      toast('Méthode disponible uniquement avec MetaMask desktop. Importez le token manuellement.', { icon: 'ℹ️' });
      return;
    }
    try {
      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: TOKEN_ADDRESS,
            symbol: 'SGC',
            decimals: 18,
            image: '/logo.png',
          },
        },
      });
      toast.success('Token ajouté à MetaMask !');
    } catch (err) {
      toast.error('Erreur lors de l\'ajout du token.');
    }
  };

  const handleTransfer = async () => {
    if (!contract || !signer) {
      toast.error('Wallet non prêt');
      return;
    }
    if (chainId !== 11155111) {
      toast.error('Vous devez être sur le réseau Sepolia');
      return;
    }
    if (!transferTo || !transferAmount) {
      toast.error('Adresse et montant requis');
      return;
    }
    try {
      const tx = await contract.transfer(transferTo, ethers.utils.parseUnits(transferAmount, 18));
      toast.success('Transfert en cours...');
      await tx.wait();
      toast.success('Transfert réussi !');
      refreshBalance();
      setTransferTo('');
      setTransferAmount('');
      setShowSendModal(false);
      fetchHistory();
      fetchMarketEvents();
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  };

  const copyAddress = () => {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    toast.success('Adresse copiée !');
    setTimeout(() => setCopied(false), 2000);
  };

  // Récupération des transactions SGC
  const fetchHistory = useCallback(async () => {
    if (!account || !walletClient) return;
    const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY;
    if (!apiKey) {
      setSgcHistory([
        { from: "0x4a3f...7b2c", to: account, value: "150.00", timestamp: "Aujourd'hui, 10:24", isReceived: true },
        { from: account, to: "0x8d21...9f3e", value: "50.00", timestamp: "Hier, 18:45", isReceived: false },
        { from: "0x7e89...3c1a", to: account, value: "200.00", timestamp: "12 Mai, 14:32", isReceived: true },
        { from: account, to: "0x2b46...8d7f", value: "75.25", timestamp: "10 Mai, 09:15", isReceived: false },
      ]);
      return;
    }
    setLoadingHistory(true);
    try {
      const url = `https://api-sepolia.etherscan.io/api?module=account&action=tokentx&address=${account}&sort=desc&apikey=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === '1' && data.result) {
        const filtered = data.result
          .filter(tx => tx.contractAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase())
          .slice(0, 10)
          .map(tx => ({
            from: tx.from,
            to: tx.to,
            value: ethers.utils.formatUnits(tx.value, tx.tokenDecimal),
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(),
            isReceived: tx.to.toLowerCase() === account.toLowerCase(),
          }));
        setSgcHistory(filtered);
      } else {
        setSgcHistory([]);
      }
    } catch (err) {
      toast.error('Erreur lors du chargement de l\'historique');
    } finally {
      setLoadingHistory(false);
    }
  }, [account, walletClient]);

  // Récupération des événements Marketplace (corrigée)
  const fetchMarketEvents = useCallback(async () => {
    if (!account || !walletClient) return;
    setLoadingMarket(true);
    try {
      const provider = new ethers.providers.Web3Provider(walletClient.transport);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, provider);
      
      const [listedLogs, saleLogs, cancelLogs] = await Promise.all([
        marketContract.queryFilter(marketContract.filters.Listed(), -10000),
        marketContract.queryFilter(marketContract.filters.Sale(), -10000),
        marketContract.queryFilter(marketContract.filters.Cancelled(), -10000)
      ]);

      const all = [
        ...listedLogs.map(log => ({
          type: 'listed',
          tokenId: log.args.tokenId.toString(),
          seller: log.args.seller,
          price: ethers.utils.formatUnits(log.args.price, 18), // déjà string
          blockNumber: log.blockNumber
        })),
        ...saleLogs.map(log => ({
          type: 'sale',
          tokenId: log.args.tokenId.toString(),
          buyer: log.args.buyer,
          price: ethers.utils.formatUnits(log.args.price, 18),
          blockNumber: log.blockNumber
        })),
        ...cancelLogs.map(log => ({
          type: 'cancel',
          tokenId: log.args.tokenId.toString(),
          seller: log.args.seller,
          blockNumber: log.blockNumber
        }))
      ];

      all.sort((a, b) => b.blockNumber - a.blockNumber);
      setMarketEvents(all.slice(0, 20));
    } catch (err) {
      console.error('Erreur chargement événements marketplace', err);
    } finally {
      setLoadingMarket(false);
    }
  }, [account, walletClient]);

  useEffect(() => {
    if (isConnected) {
      fetchHistory();
      fetchMarketEvents();
    }
  }, [isConnected, fetchHistory, fetchMarketEvents]);

  // Fusionner les historiques
  const unifiedHistory = [...sgcHistory, ...marketEvents].sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : (a.blockNumber * 15000);
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : (b.blockNumber * 15000);
    return timeB - timeA;
  }).slice(0, 20);

  // Rendu d'un élément d'historique
  const renderHistoryItem = (item, idx) => {
    const isSGC = item.from !== undefined;
    if (isSGC) {
      return (
        <div key={`sgc-${idx}`} className="flex justify-between items-center border-b border-gray-100 dark:border-gray-700 pb-2">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.isReceived ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
              {item.isReceived ? '⬇️' : '⬆️'}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white">
                {item.isReceived ? 'Reçu' : 'Envoyé'}
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">SGC</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {item.isReceived ? `De : ${item.from.slice(0,6)}...${item.from.slice(-4)}` : `À : ${item.to.slice(0,6)}...${item.to.slice(-4)}`}
              </p>
              <p className="text-xs text-gray-400">{item.timestamp}</p>
            </div>
          </div>
          <p className={`font-bold ${item.isReceived ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {item.isReceived ? '+' : '-'} {parseFloat(item.value).toFixed(2)} SGC
          </p>
        </div>
      );
    } else {
      const badgeColor = item.type === 'listed' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                         item.type === 'sale' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                         'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
      const typeLabel = item.type === 'listed' ? 'NFT listé' : item.type === 'sale' ? 'NFT acheté' : 'Vente annulée';
      return (
        <div key={`nft-${idx}`} className="flex justify-between items-center border-b border-gray-100 dark:border-gray-700 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
              🖼️
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-white">
                {typeLabel} <span className={`px-2 py-0.5 text-xs rounded-full ${badgeColor}`}>NFT #{item.tokenId}</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {item.type === 'listed' && `Par : ${item.seller.slice(0,6)}... • Prix : ${item.price || 'N/A'} SGC`}
                {item.type === 'sale' && `Acheteur : ${item.buyer.slice(0,6)}... • Prix : ${item.price || 'N/A'} SGC`}
                {item.type === 'cancel' && `Par : ${item.seller.slice(0,6)}...`}
              </p>
              <p className="text-xs text-gray-400">Bloc #{item.blockNumber}</p>
            </div>
          </div>
        </div>
      );
    }
  };

  // Valeur USD approximative
  const usdValue = (parseFloat(balance) * 0.25).toFixed(2);

  // Navigation bar items
  const navItems = [
    { page: 'home', label: 'Accueil', icon: '🏠' },
    { page: 'nft', label: 'NFT', icon: '🖼️' },
    { page: 'settings', label: 'Paramètres', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen w-full bg-gray-100 dark:bg-gray-900 transition-colors duration-300 flex flex-col">
      <Toaster position="top-right" />

      {/* Barre de navigation - en haut sur desktop, en bas sur mobile */}
      <nav className="bg-white dark:bg-gray-800 shadow-md md:shadow-lg w-full fixed top-0 md:top-0 bottom-auto md:bottom-auto z-20 order-1 md:order-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center md:justify-between items-center h-14 md:h-16">
            <div className="hidden md:flex items-center gap-2">
              <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-full" onError={(e) => (e.target.style.display = 'none')} />
              <span className="font-bold text-gray-800 dark:text-white">SangoCoin</span>
            </div>
            <div className="flex space-x-6 md:space-x-8">
              {navItems.map((item) => (
                <button
                  key={item.page}
                  onClick={() => setCurrentPage(item.page)}
                  className={`flex flex-col items-center justify-center transition-colors ${
                    currentPage === item.page
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                  }`}
                >
                  <span className="text-2xl md:text-xl">{item.icon}</span>
                  <span className="text-xs mt-0.5">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Contenu principal */}
      <main className="flex-1 w-full mt-14 md:mt-16 mb-14 md:mb-0 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 md:mb-6">
            <WalletConnector />
          </div>

          {!isConnected ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-20 text-lg">
              Connectez votre wallet pour commencer
            </div>
          ) : (
            <>
              {/* Solde SGC */}
              <div className="text-center mb-6 md:mb-8">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Solde SGC</p>
                <p className="text-4xl font-extrabold text-gray-800 dark:text-white mt-1">
                  {parseFloat(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SGC
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">≈ ${usdValue} USD</p>
              </div>

              {/* Page Accueil */}
              {currentPage === 'home' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setShowSendModal(true)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-xl shadow transition flex items-center justify-center gap-2"
                    >
                      <span className="text-xl"></span> Envoyer SGC
                    </button>
                    <button
                      onClick={() => setShowReceiveModal(true)}
                      className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-semibold py-4 rounded-xl shadow transition flex items-center justify-center gap-2"
                    >
                      <span className="text-xl"></span> Recevoir SGC
                    </button>
                  </div>

                  {/* Historique unifié */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">Historique des transactions</h3>
                    {(loadingHistory || loadingMarket) ? (
                      <p className="text-center text-gray-500 py-4">Chargement...</p>
                    ) : unifiedHistory.length > 0 ? (
                      <div className="space-y-3 max-h-80 overflow-y-auto">
                        {unifiedHistory.map(renderHistoryItem)}
                      </div>
                    ) : (
                      <p className="text-center text-gray-500 py-4">Aucune transaction trouvée.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Page NFT */}
              {currentPage === 'nft' && (
                <div className="max-w-full">
                  <NftMarketplace signer={signer} account={account} chainId={chainId} />
                </div>
              )}

              {/* Page Paramètres */}
              {currentPage === 'settings' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Paramètres</h3>
                  <button onClick={switchToSepolia}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium py-3 rounded-lg shadow text-sm">
                    Basculer sur le réseau Sepolia
                  </button>
                  <button onClick={addTokenToMetaMask}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-lg shadow text-sm">
                    Ajouter SGC à MetaMask
                  </button>
                  {isOwner && (
                    <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800/50">
                      <p className="text-sm text-green-800 dark:text-green-300 font-medium">👑 Vous êtes le propriétaire du token.</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">Les fonctions de mint sont disponibles via l'ancienne interface si nécessaire.</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
                    Wallet connecté : <span className="font-mono">{account?.slice(0, 8)}...{account?.slice(-6)}</span>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Modales Envoyer / Recevoir */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-sm w-full p-5 shadow-xl">
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">Envoyer SGC</h3>
            {chainId !== 11155111 && (
              <p className="text-xs text-red-500 mb-2">⚠️ Vous n'êtes pas sur Sepolia. <button onClick={switchToSepolia} className="underline">Basculer</button></p>
            )}
            <input
              type="text"
              placeholder="Adresse destinataire (0x...)"
              value={transferTo}
              onChange={e => setTransferTo(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 mb-3 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
            <input
              type="number"
              placeholder="Montant en SGC"
              value={transferAmount}
              onChange={e => setTransferAmount(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 mb-4 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
            />
            <div className="flex gap-2">
              <button onClick={handleTransfer} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg">
                Confirmer
              </button>
              <button onClick={() => setShowSendModal(false)} className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white py-2 rounded-lg">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && account && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-sm w-full p-5 text-center shadow-xl">
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2">Recevoir SGC</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Scannez ou copiez votre adresse</p>
            <div className="bg-white p-3 inline-block rounded-xl shadow mx-auto mb-3">
              <QRCode value={account} size={140} />
            </div>
            <p className="text-xs font-mono break-all bg-gray-100 dark:bg-gray-700 p-2 rounded mb-3 text-gray-700 dark:text-gray-300">{account}</p>
            <button onClick={copyAddress} className="bg-gray-700 hover:bg-gray-800 text-white py-2 px-4 rounded-lg text-sm">
              {copied ? 'Copié !' : 'Copier l\'adresse'}
            </button>
            <button onClick={() => setShowReceiveModal(false)} className="block w-full mt-3 text-indigo-500 text-sm">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;