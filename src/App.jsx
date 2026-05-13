import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import QRCode from 'qrcode.react';

import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';

import { config } from './config';
import TokenArtifact from './contracts/SangoCoin.json';

const TOKEN_ADDRESS = '0x55E3AC18F352cd77A01612d7C595Cb5bE367FB97';
const ABI = TokenArtifact.abi;

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

function WalletConnector() {
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { address: account, isConnected } = useAccount();

  if (isConnected) {
    return (
      <div className="flex items-center justify-between bg-white/80 rounded-lg p-3 shadow-sm border border-gray-200">
        <span className="text-sm font-mono text-gray-700 truncate">
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
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-4 rounded-lg shadow transition-colors"
        >
          {connector.name === 'Injected'
            ? 'MetaMask (ou wallet navigateur)'
            : 'WalletConnect (QR code)'}
        </button>
      ))}
    </div>
  );
}

function MainContent() {
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [balance, setBalance] = useState('0');
  const [isOwner, setIsOwner] = useState(false);

  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [mintTo, setMintTo] = useState('');
  const [mintAmount, setMintAmount] = useState('');

  const [activeTab, setActiveTab] = useState('send');
  const [copied, setCopied] = useState(false);

  const [tokenList, setTokenList] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(false);

  const { address: account, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

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
    }
  }

  const refreshBalance = useCallback(async () => {
    if (!contract || !account) return;
    const bal = await contract.balanceOf(account);
    setBalance(ethers.utils.formatUnits(bal, 18));
  }, [contract, account]);

  const switchToSepolia = async () => {
    if (!window.ethereum) return;
    const sepoliaChainId = '0xaa36a7';
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: sepoliaChainId }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: sepoliaChainId,
            chainName: 'Sepolia Testnet',
            rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 }
          }]
        });
      } else {
        toast.error('Erreur lors du changement de réseau');
      }
    }
  };

  const addTokenToMetaMask = async () => {
    if (!window.ethereum) return;
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
    if (!contract || !transferTo || !transferAmount) return;
    try {
      const tx = await contract.transfer(transferTo, ethers.utils.parseUnits(transferAmount, 18));
      toast.success('Transfert en cours...');
      await tx.wait();
      toast.success('Transfert réussi !');
      refreshBalance();
      setTransferTo('');
      setTransferAmount('');
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  };

  const handleMint = async () => {
    if (!contract || !mintTo || !mintAmount) return;
    try {
      const tx = await contract.mint(mintTo, ethers.utils.parseUnits(mintAmount, 18));
      toast.success('Mint en cours...');
      await tx.wait();
      toast.success('Tokens créés !');
      refreshBalance();
      setMintTo('');
      setMintAmount('');
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

  // Récupération des tokens détenus via Etherscan (Sepolia)
  const fetchTokenList = async () => {
    if (!account) return;
    const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY;
    if (!apiKey) {
      toast.error('Clé API Etherscan manquante');
      return;
    }
    setLoadingTokens(true);
    try {
      // ---- 1. Récupérer les transactions de tokens ----
      const url = `https://api-sepolia.etherscan.io/api?module=account&action=tokentx&address=${account}&sort=desc&apikey=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      // Liste finale
      const contractsData = [];

      // ---- 2. Ajouter SangoCoin (SGC) en priorité ----
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const sgcContract = new ethers.Contract(TOKEN_ADDRESS, ABI, provider);
      const sgcBalance = await sgcContract.balanceOf(account);
      if (sgcBalance.gt(0)) {
        contractsData.push({
          address: TOKEN_ADDRESS,
          symbol: 'SGC',
          balance: ethers.utils.formatUnits(sgcBalance, 18),
        });
      }

      // ---- 3. Traiter les autres tokens (issus des transactions) ----
      if (data.status === '0' && data.message === 'No transactions found') {
        // Aucune transaction, on garde juste SGC (déjà ajouté)
      } else if (data.status === '1' && data.result) {
        const tokenAddresses = [...new Set(data.result.map(tx => tx.contractAddress))];
        // Filtrer pour ne pas ajouter SGC en double
        const minABI = ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

        for (const addr of tokenAddresses) {
          if (addr.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) continue; // déjà ajouté
          try {
            const tok = new ethers.Contract(addr, minABI, provider);
            const bal = await tok.balanceOf(account);
            if (bal.gt(0)) {
              const symbol = await tok.symbol();
              const decimals = await tok.decimals();
              contractsData.push({
                address: addr,
                symbol,
                balance: ethers.utils.formatUnits(bal, decimals),
              });
            }
          } catch (e) {
            // ignorer les contrats non-ERC20
          }
        }
      } else {
        // Cas d'erreur API inattendu, on conserve SGC si déjà ajouté
      }

      setTokenList(contractsData);
    } catch (err) {
      toast.error('Erreur lors du chargement des jetons');
    } finally {
      setLoadingTokens(false);
    }
  };

  useEffect(() => {
    if (isConnected && activeTab === 'tokens') {
      fetchTokenList();
    }
  }, [isConnected, activeTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'send':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Envoyer des SGC</h3>
            <input type="text" placeholder="Adresse destinataire" value={transferTo}
              onChange={e => setTransferTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <input type="number" placeholder="Montant" value={transferAmount}
              onChange={e => setTransferAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            <button onClick={handleTransfer}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg shadow transition">
              Envoyer
            </button>
          </div>
        );

      case 'receive':
        return (
          <div className="space-y-4 text-center">
            <h3 className="text-lg font-semibold text-gray-800">Recevoir des SGC</h3>
            <p className="text-sm text-gray-500">Scannez ce QR code ou partagez votre adresse.</p>
            {account && (
              <div className="bg-white p-4 inline-block rounded-xl shadow border">
                <QRCode value={account} size={180} />
              </div>
            )}
            <div className="bg-gray-100 p-3 rounded-lg text-xs font-mono break-all text-gray-700">
              {account}
            </div>
            <button onClick={copyAddress}
              className="bg-gray-700 hover:bg-gray-800 text-white py-2 px-4 rounded-lg shadow text-sm font-medium">
              {copied ? 'Copié !' : 'Copier l\'adresse'}
            </button>
          </div>
        );

      case 'swap':
        return (
          <div className="text-center py-10 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Échanger SGC</h3>
            <p className="text-gray-500 text-sm">
              Vous pouvez échanger SangoCoin sur Uniswap (testnet Sepolia).<br />
              Assurez‑vous d'avoir des SGC et un peu d'ETH pour les frais.
            </p>
            <a
              href={`https://app.uniswap.org/#/swap?chain=sepolia&outputCurrency=${TOKEN_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-6 rounded-lg shadow transition-colors"
            >
              Ouvrir Uniswap Sepolia
            </a>
            <p className="text-xs text-gray-400">
              * L'échange ne sera possible que si de la liquidité existe sur la paire SGC/ETH.
            </p>
          </div>
        );

      case 'buy':
        return (
          <div className="text-center py-10">
            <h3 className="text-lg font-semibold text-gray-800">Acheter des SGC</h3>
            <p className="text-gray-500 mt-4 text-sm">L'achat direct n'est pas encore intégré.</p>
          </div>
        );

      case 'tokens':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Mes jetons</h3>
            {loadingTokens ? (
              <p className="text-sm text-gray-500">Chargement...</p>
            ) : tokenList.length > 0 ? (
              <ul className="divide-y divide-gray-200 max-h-60 overflow-y-auto">
                {tokenList.map((token, idx) => (
                  <li key={idx} className="py-3 flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-800">{token.symbol}</p>
                      <p className="text-xs text-gray-400 truncate w-40">{token.address}</p>
                    </div>
                    <span className="font-semibold text-gray-700">{token.balance}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">Aucun jeton trouvé.</p>
            )}
            <button onClick={addTokenToMetaMask}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg shadow text-sm">
              Ajouter SGC à MetaMask
            </button>
            {isOwner && (
              <details className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <summary className="font-medium text-green-700 cursor-pointer">
                  Mint (Créer des tokens)
                </summary>
                <div className="mt-3 space-y-2">
                  <input type="text" placeholder="Adresse bénéficiaire" value={mintTo}
                    onChange={e => setMintTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
                  <input type="number" placeholder="Montant" value={mintAmount}
                    onChange={e => setMintAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
                  <button onClick={handleMint}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg shadow text-sm">
                    Mint
                  </button>
                </div>
              </details>
            )}
          </div>
        );

      case 'history':
        return (
          <div className="text-center py-10">
            <h3 className="text-lg font-semibold text-gray-800">Historique</h3>
            <p className="text-gray-500 mt-4 text-sm">Consultez vos transactions sur Etherscan.</p>
            <a href={`https://sepolia.etherscan.io/address/${account}`} target="_blank" rel="noopener noreferrer"
              className="text-indigo-600 underline text-sm mt-2 inline-block">
              Ouvrir Etherscan
            </a>
          </div>
        );

      case 'settings':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Paramètres</h3>
            <button onClick={switchToSepolia}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-medium py-3 rounded-lg shadow text-sm">
              Basculer sur le réseau Sepolia
            </button>
            <button onClick={addTokenToMetaMask}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-lg shadow text-sm">
              Ajouter SGC à MetaMask
            </button>
            <p className="text-xs text-gray-500 mt-4">
              Wallet connecté : <span className="font-mono">{account?.slice(0, 8)}...{account?.slice(-6)}</span>
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Toaster position="top-right" />
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 text-center">
            <img
              src="/logo.png"
              alt="Logo"
              className="w-16 h-16 mx-auto mb-3 rounded-full shadow-lg object-cover border-2 border-white"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <h1 className="text-2xl font-bold text-white">SangoCoin</h1>
            <p className="text-slate-300 text-xs mt-1">Token ERC-20 sur Sepolia</p>
          </div>

          <div className="p-6">
            <div className="mb-6">
              <WalletConnector />
            </div>

            {isConnected ? (
              <div className="flex flex-col max-h-[80vh] overflow-y-auto">
                <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg p-4 text-white shadow-md mb-6">
                  <p className="text-sm opacity-80">Solde SGC</p>
                  <p className="text-3xl font-bold mt-1">{balance} <span className="text-lg font-medium">SGC</span></p>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {[
                    { key: 'send', label: 'Envoyer' },
                    { key: 'receive', label: 'Recevoir' },
                    { key: 'swap', label: 'Swap' },
                    { key: 'buy', label: 'Acheter' },
                    { key: 'tokens', label: 'Jetons' },
                    { key: 'history', label: 'Historique' },
                    { key: 'settings', label: 'Paramètres' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                        activeTab === tab.key
                          ? 'bg-slate-800 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                  {renderTabContent()}
                </div>
              </div>
            ) : (
              <p className="text-center text-gray-500 text-sm">Connectez votre wallet pour commencer</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;