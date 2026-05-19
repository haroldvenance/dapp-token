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

const TOTAL_NFTS = 10; // NFT #0 à #9

function NftMarketplace({ signer, account, chainId }) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState({}); // tokenId -> true/false
  const [listPrices, setListPrices] = useState({}); // tokenId -> prix saisi

  // Charger les métadonnées des 10 NFTs
  const loadNFTs = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    try {
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

      const items = [];
      for (let i = 0; i < TOTAL_NFTS; i++) {
        try {
          const uri = await nftContract.tokenURI(i);
          const owner = await nftContract.ownerOf(i);
          const listed = await marketContract.isListed(i);
          let listing = null;
          if (listed) {
            const res = await marketContract.listings(i);
            listing = {
              seller: res.seller,
              price: ethers.utils.formatUnits(res.price, 18),
              rawPrice: res.price,
              active: res.active
            };
          }
          // Récupérer le JSON IPFS
          let metadata = { name: `SangoTech #${i}`, image: '' };
          try {
            const httpUri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            const resp = await fetch(httpUri);
            if (resp.ok) metadata = await resp.json();
            if (metadata.image && metadata.image.startsWith('ipfs://')) {
              metadata.image = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }
          } catch (e) {
            console.warn('Erreur chargement metadata', i, e.message);
          }
          items.push({
            tokenId: i,
            owner,
            metadata,
            listed,
            listing
          });
        } catch (e) {
          console.warn('Erreur token', i, e.message);
        }
      }
      setNfts(items);
    } catch (err) {
      toast.error('Erreur chargement NFTs');
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => {
    loadNFTs();
  }, [loadNFTs]);

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
      // Réinitialiser le prix saisi
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
      <h3 className="text-lg font-semibold text-gray-800">🎨 Galerie SangoTech NFT</h3>

      {/* Grille des NFTs */}
      <div className="grid grid-cols-2 gap-4">
        {nfts.map(item => (
          <div key={item.tokenId} className="bg-white rounded-xl shadow p-2 flex flex-col items-center text-center">
            {item.metadata.image ? (
              <img src={item.metadata.image} alt={item.metadata.name} className="w-full h-32 object-cover rounded-lg" />
            ) : (
              <div className="w-full h-32 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">Pas d'image</div>
            )}
            <p className="text-sm font-medium mt-1">{item.metadata.name}</p>
            <p className="text-xs text-gray-500">#{item.tokenId}</p>
            <p className="text-xs text-gray-400 truncate w-full" title={item.owner}>
              {item.owner.slice(0,6)}...
            </p>

            {/* Actions selon l'état */}
            {item.listed && item.listing?.active ? (
              <div className="mt-2 w-full">
                <p className="text-xs font-semibold text-green-700">{item.listing.price} SGC</p>
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
                      className="w-full text-xs border rounded px-2 py-1 mb-1 focus:ring-2 focus:ring-green-400 outline-none"
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
                {item.owner.toLowerCase() !== account?.toLowerCase() && (
                  <p className="text-xs text-gray-500">Non listé</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default NftMarketplace;