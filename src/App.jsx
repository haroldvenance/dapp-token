import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';

import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';

import { config } from './config';
import TokenArtifact from './contracts/SangoCoin.json';

// ----- Constantes -----
const TOKEN_ADDRESS = '0x55E3AC18F352cd77A01612d7C595Cb5bE367FB97';
const ABI = TokenArtifact.abi;

// ----- Adaptateur WalletClient viem → Signer ethers -----
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

// ----- Boutons de connexion / déconnexion -----
function WalletConnector() {
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { address: account, isConnected } = useAccount();

  if (isConnected) {
    return (
      <div className="bg-gray-100 rounded-lg p-2 flex items-center justify-between">
        <span className="text-sm font-mono truncate">
          {account?.slice(0, 6)}...{account?.slice(-4)}
        </span>
        <button onClick={disconnect} className="text-red-500 text-sm underline">
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
          className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow transition-colors"
        >
          {connector.name === 'Injected'
            ? '🦊 MetaMask (ou wallet navigateur)'
            : '📱 WalletConnect (QR code)'}
        </button>
      ))}
    </div>
  );
}

// ----- Contenu principal -----
function MainContent() {
  // États liés au contrat
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [balance, setBalance] = useState('0');
  const [isOwner, setIsOwner] = useState(false);

  // États pour les formulaires
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [mintTo, setMintTo] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [burnAmount, setBurnAmount] = useState('');

  // Hooks wagmi
  const { address: account, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  // ----- Conversion du WalletClient en Signer -----
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
      console.error('Erreur conversion signer', err);
      toast.error('Erreur de connexion au wallet');
    }
  }, [isConnected, walletClient]);

  // ----- Création du contrat ethers et lecture initiale -----
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
      console.error('Erreur lecture contrat', err);
    }
  }

  const refreshBalance = useCallback(async () => {
    if (!contract || !account) return;
    const bal = await contract.balanceOf(account);
    setBalance(ethers.utils.formatUnits(bal, 18));
  }, [contract, account]);

  // ----- Switch réseau Sepolia -----
  async function switchToSepolia() {
    if (!window.ethereum) return;
    const sepoliaChainId = '0xaa36a7';
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: sepoliaChainId }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
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
        } catch (addError) {
          toast.error('Impossible d\'ajouter le réseau Sepolia');
        }
      } else {
        toast.error('Erreur lors du changement de réseau');
      }
    }
  }

  // ----- Ajouter le token à MetaMask -----
  async function addTokenToMetaMask() {
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
            image: '/logo.png', // logo local (sera résolu en URL absolue par le navigateur)
          },
        },
      });
      toast.success('Token ajouté à MetaMask !');
    } catch (err) {
      toast.error('Erreur lors de l\'ajout du token.');
    }
  }

  // ----- Transactions -----
  async function handleTransfer() {
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
  }

  async function handleMint() {
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
  }

  async function handleBurn() {
    if (!contract || !burnAmount) return;
    try {
      const tx = await contract.burn(ethers.utils.parseUnits(burnAmount, 18));
      toast.success('Burn en cours...');
      await tx.wait();
      toast.success('Tokens brûlés !');
      refreshBalance();
      setBurnAmount('');
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  }

  // ----- UI complète -----
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Toaster position="top-right" />
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* En-tête */}
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-center">
            <img
              src="/logo.png"
              alt="SangoCoin Logo"
              className="w-20 h-20 mx-auto mb-2 rounded-full shadow-lg object-cover border-2 border-white"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <h1 className="text-3xl font-bold text-white drop-shadow-md">SangoCoin</h1>
            <p className="text-purple-100 text-sm mt-1">Token ERC‑20 sur Sepolia</p>
          </div>

          <div className="p-6">
            {/* Connexion */}
            <div className="mb-6">
              <WalletConnector />
            </div>

            {/* Switch réseau */}
            {isConnected && (
              <div className="mb-4 text-center">
                <button onClick={switchToSepolia} className="text-xs text-amber-600 underline hover:text-amber-800">
                  ⚠ Clique ici pour basculer sur Sepolia
                </button>
              </div>
            )}

            {isConnected ? (
              <div className="space-y-6">
                {/* Solde */}
                <div className="bg-gradient-to-r from-green-400 to-green-600 rounded-lg p-4 text-white shadow-md">
                  <p className="text-sm opacity-80"> Solde SGC</p>
                  <p className="text-3xl font-bold mt-1">{balance} <span className="text-lg font-medium">SGC</span></p>
                  <p className="text-xs opacity-70 truncate mt-1" title={account}>
                    {account?.slice(0, 8)}...{account?.slice(-6)}
                  </p>
                </div>

                {/* Ajouter à MetaMask */}
                <button
                  onClick={addTokenToMetaMask}
                  className="w-full bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-bold py-2 rounded-lg shadow transition-all duration-200"
                >
                  🦊 Ajouter SGC à MetaMask
                </button>

                {/* Sections pliables */}
                <div className="space-y-3">
                  {/* Transfert */}
                  <details className="group bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <summary className="font-semibold cursor-pointer text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
                      <span className="text-lg"></span> Transfert
                    </summary>
                    <div className="mt-3 space-y-2">
                      <input type="text" placeholder="Adresse destinataire" value={transferTo}
                        onChange={e => setTransferTo(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                      <input type="number" placeholder="Montant" value={transferAmount}
                        onChange={e => setTransferAmount(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                      <button onClick={handleTransfer}
                        className="w-full bg-blue-500 hover:bg-blue-600 active:scale-95 text-white py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-1">
                        <span></span> Envoyer
                      </button>
                    </div>
                  </details>

                  {/* Mint (owner) */}
                  {isOwner && (
                    <details className="group bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <summary className="font-semibold cursor-pointer text-green-600 hover:text-green-700 flex items-center gap-2">
                        <span className="text-lg"></span> Mint (Créer des tokens)
                      </summary>
                      <div className="mt-3 space-y-2">
                        <input type="text" placeholder="Adresse bénéficiaire" value={mintTo}
                          onChange={e => setMintTo(e.target.value)}
                          className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-green-400 focus:outline-none" />
                        <input type="number" placeholder="Montant" value={mintAmount}
                          onChange={e => setMintAmount(e.target.value)}
                          className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-green-400 focus:outline-none" />
                        <button onClick={handleMint}
                          className="w-full bg-green-500 hover:bg-green-600 active:scale-95 text-white py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-1">
                          <span></span> Mint
                        </button>
                      </div>
                    </details>
                  )}

                  {/* Burn */}
                  <details className="group bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <summary className="font-semibold cursor-pointer text-red-600 hover:text-red-700 flex items-center gap-2">
                      <span className="text-lg"></span> Burn (Brûler des tokens)
                    </summary>
                    <div className="mt-3 space-y-2">
                      <input type="number" placeholder="Montant" value={burnAmount}
                        onChange={e => setBurnAmount(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-red-400 focus:outline-none" />
                      <button onClick={handleBurn}
                        className="w-full bg-red-500 hover:bg-red-600 active:scale-95 text-white py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-1">
                        <span></span> Brûler
                      </button>
                    </div>
                  </details>
                </div>

                {/* Note wallets */}
                <p className="text-xs text-gray-500 mt-4 border-t pt-4">
                  DApp compatible avec tout wallet EVM (MetaMask, Rabby, Coinbase, etc.).<br />
                  Pour mobile, utilisez WalletConnect (QR code). Si un avertissement "jeton non vérifié" apparaît, importez-le manuellement avec l'adresse du contrat.
                </p>
              </div>
            ) : (
              <p className="text-center text-gray-500">Connectez votre wallet pour commencer</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;