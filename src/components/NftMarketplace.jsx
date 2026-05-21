import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

// ABIs minimales
const NFT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function approve(address to, uint256 tokenId) external",
  "function getApproved(uint256 tokenId) view returns (address)"
];

const MARKET_ABI = [
  "function listNFT(uint256 tokenId, uint256 price) external",
  "function buyNFT(uint256 tokenId) external",
  "function cancelListing(uint256 tokenId) external",
  "function listings(uint256 tokenId) view returns (address seller, uint256 price, bool active)",
  "function isListed(uint256 tokenId) view returns (bool)"
];

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

// Adresses déployées sur Sepolia
const NFT_ADDRESS = "0xBAD996537E58F4a72c6d7d0d6ECe38bf43d9d559";
const MARKET_ADDRESS = "0xae1c6E5C3025E13E0bEd276a4a2Cd67c41CE4A28";
const TOKEN_ADDRESS = "0x55E3AC18F352cd77A01612d7C595Cb5bE367FB97";

const TOTAL_NFTS = 10;

// Clé pour le cache localStorage
const CACHE_KEY = 'nft_metadata_cache_v1';

function NftMarketplace({ signer, account, chainId }) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState({});
  const [listPrices, setListPrices] = useState({});
  const [viewMode, setViewMode] = useState('market'); // 'market' ou 'owned'

  // Fonction pour obtenir le cache
  const getCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  };

  const loadNFTs = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    try {
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);

      // Paralléliser les appels on-chain
      const tokenIds = Array.from({ length: TOTAL_NFTS }, (_, i) => i);
      const [uris, owners, isListedArr] = await Promise.all([
        Promise.all(tokenIds.map(i => nftContract.tokenURI(i).catch(() => ''))),
        Promise.all(tokenIds.map(i => nftContract.ownerOf(i).catch(() => ''))),
        Promise.all(tokenIds.map(i => marketContract.isListed(i).catch(() => false)))
      ]);

      // Récupérer les listings pour les tokens listés
      const listingPromises = isListedArr.map(async (listed, i) => {
        if (!listed) return null;
        try {
          const res = await marketContract.listings(i);
          return {
            seller: res.seller,
            price: ethers.utils.formatUnits(res.price, 18),
            rawPrice: res.price,
            active: res.active
          };
        } catch { return null; }
      });
      const listings = await Promise.all(listingPromises);

      // Charger les métadonnées avec cache
      const cache = getCache();
      const metadataPromises = uris.map(async (uri, i) => {
        // Vérifier le cache
        if (cache[i] && cache[i].uri === uri) {
          return cache[i].metadata;
        }
        if (!uri) return { name: `SangoTech #${i}`, image: '' };
        try {
          const httpUri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
          const resp = await fetch(httpUri);
          if (!resp.ok) throw new Error('Fetch failed');
          const meta = await resp.json();
          if (meta.image && meta.image.startsWith('ipfs://')) {
            meta.image = meta.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
          }
          // Mettre en cache
          cache[i] = { uri, metadata: meta };
          return meta;
        } catch {
          return { name: `SangoTech #${i}`, image: '' };
        }
      });
      const metadatas = await Promise.all(metadataPromises);
      // Sauvegarder le cache
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));

      const items = tokenIds.map(i => ({
        tokenId: i,
        owner: owners[i],
        metadata: metadatas[i],
        listed: isListedArr[i],
        listing: listings[i]
      }));
      setNfts(items);
    } catch (err) {
      toast.error('Erreur chargement NFTs');
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => { loadNFTs(); }, [loadNFTs]);

  // Filtrer les NFTs selon le mode d'affichage
  const filteredNfts = viewMode === 'owned'
    ? nfts.filter(item => item.owner.toLowerCase() === account?.toLowerCase())
    : nfts.filter(item => item.listed && item.listing?.active);

  // Indique si l'action est en cours pour un token donné
  const isActionLoading = (tokenId) => !!loadingAction[tokenId];

  // Lister un NFT
  const handleList = async (tokenId) => {
    const price = listPrices[tokenId];
    if (!price) return toast.error('Veuillez entrer un prix');
    if (!signer) return;
    setLoadingAction(prev => ({ ...prev, [tokenId]: true }));
    try {
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      // 1. Approbation
      const approved = await nftContract.getApproved(tokenId);
      if (approved.toLowerCase() !== MARKET_ADDRESS.toLowerCase()) {
        const txApprove = await nftContract.approve(MARKET_ADDRESS, tokenId);
        await txApprove.wait();
        toast.success('Approbation NFT accordée');
      }
      // 2. Lister
      const priceWei = ethers.utils.parseUnits(price, 18);
      const txList = await marketContract.listNFT(tokenId, priceWei);
      await txList.wait();
      toast.success('NFT listé avec succès');
      setListPrices(prev => ({ ...prev, [tokenId]: '' }));
      await loadNFTs();
    } catch (err) {
      toast.error(err.reason || err.message);
    } finally {
      setLoadingAction(prev => ({ ...prev, [tokenId]: false }));
    }
  };

  // Acheter un NFT
  const handleBuy = async (tokenId, priceWei) => {
    if (!signer) return;
    setLoadingAction(prev => ({ ...prev, [tokenId]: true }));
    try {
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      // 1. Approbation SGC
      const allowance = await tokenContract.allowance(account, MARKET_ADDRESS);
      if (allowance.lt(priceWei)) {
        const txApprove = await tokenContract.approve(MARKET_ADDRESS, priceWei);
        await txApprove.wait();
        toast.success('Approbation SGC accordée');
      }
      // 2. Acheter
      const txBuy = await marketContract.buyNFT(tokenId);
      await txBuy.wait();
      toast.success('NFT acheté !');
      await loadNFTs();
    } catch (err) {
      toast.error(err.reason || err.message);
    } finally {
      setLoadingAction(prev => ({ ...prev, [tokenId]: false }));
    }
  };

  // Annuler une vente
  const handleCancel = async (tokenId) => {
    if (!signer) return;
    setLoadingAction(prev => ({ ...prev, [tokenId]: true }));
    try {
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tx = await marketContract.cancelListing(tokenId);
      await tx.wait();
      toast.success('Vente annulée');
      await loadNFTs();
    } catch (err) {
      toast.error(err.reason || err.message);
    } finally {
      setLoadingAction(prev => ({ ...prev, [tokenId]: false }));
    }
  };

  // Vérification réseau
  if (chainId && chainId !== 11155111) {
    return (
      <div className="text-center py-10">
        <p className="text-red-500 font-medium">Vous n'êtes pas sur le réseau Sepolia.</p>
        <p className="text-sm text-gray-500 mt-2">Allez dans Paramètres pour basculer.</p>
      </div>
    );
  }

  if (!signer) {
    return <p className="text-center text-gray-500">Connectez votre wallet pour voir les NFTs.</p>;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent"></div>
        <span className="ml-3 text-gray-600">Chargement des NFTs...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* En-tête avec navigation des vues */}
      {account && (
        <div className="flex justify-center gap-4 mb-4">
          <button
            onClick={() => setViewMode('market')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              viewMode === 'market'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Marché
          </button>
          <button
            onClick={() => setViewMode('owned')}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              viewMode === 'owned'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Mes NFTs
          </button>
        </div>
      )}

      {/* Galerie filtrée */}
      {filteredNfts.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          {viewMode === 'market' ? 'Aucun NFT en vente pour le moment.' : 'Vous ne possédez aucun NFT.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filteredNfts.map(item => (
            <div key={item.tokenId} className="bg-white dark:bg-gray-800 rounded-xl shadow p-2 flex flex-col items-center text-center">
              {item.metadata.image ? (
                <img src={item.metadata.image} alt={item.metadata.name} className="w-full h-32 object-cover rounded-lg" />
              ) : (
                <div className="w-full h-32 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">Pas d'image</div>
              )}
              <p className="text-sm font-medium mt-1 text-gray-800 dark:text-white">{item.metadata.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">#{item.tokenId}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate w-full" title={item.owner}>
                {item.owner.slice(0,6)}...
              </p>

              {/* Actions selon l'état */}
              {item.listed && item.listing?.active ? (
                <div className="mt-2 w-full">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400">{item.listing.price} SGC</p>
                  {item.owner.toLowerCase() === account?.toLowerCase() ? (
                    <button
                      onClick={() => handleCancel(item.tokenId)}
                      disabled={isActionLoading(item.tokenId)}
                      className={`mt-1 w-full text-white text-xs py-1 rounded transition ${
                        isActionLoading(item.tokenId)
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-red-500 hover:bg-red-600'
                      }`}
                    >
                      {isActionLoading(item.tokenId) ? '⏳...' : 'Annuler vente'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBuy(item.tokenId, item.listing.rawPrice)}
                      disabled={isActionLoading(item.tokenId)}
                      className={`mt-1 w-full text-white text-xs py-1 rounded transition ${
                        isActionLoading(item.tokenId)
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700'
                      }`}
                    >
                      {isActionLoading(item.tokenId) ? '⏳...' : 'Acheter'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-2 w-full">
                  {item.owner.toLowerCase() === account?.toLowerCase() && (
                    <div>
                      <input
                        type="number"
                        placeholder="Prix en SGC"
                        value={listPrices[item.tokenId] || ''}
                        onChange={(e) => setListPrices(prev => ({ ...prev, [item.tokenId]: e.target.value }))}
                        className="w-full text-xs border rounded px-2 py-1 mb-1 focus:ring-2 focus:ring-green-400 outline-none bg-white dark:bg-gray-700 text-gray-800 dark:text-white border-gray-300 dark:border-gray-600"
                        disabled={isActionLoading(item.tokenId)}
                      />
                      <button
                        onClick={() => handleList(item.tokenId)}
                        disabled={isActionLoading(item.tokenId) || !listPrices[item.tokenId]}
                        className={`w-full text-white text-xs py-1 rounded transition ${
                          isActionLoading(item.tokenId) || !listPrices[item.tokenId]
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-green-600 hover:bg-green-700'
                        }`}
                      >
                        {isActionLoading(item.tokenId) ? '⏳...' : 'Lister'}
                      </button>
                    </div>
                  )}
                  {item.owner.toLowerCase() !== account?.toLowerCase() && !item.listed && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Non listé</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NftMarketplace;