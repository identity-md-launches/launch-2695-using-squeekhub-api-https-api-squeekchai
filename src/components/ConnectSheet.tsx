import { useState } from "react";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import { getAddress } from "viem";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { openIn } from "../lib/wallet";
export function ConnectSheet({ onClose }: { onClose: () => void }) {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState("");
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !connectors.some(
      (connector) =>
        connector.type === "injected" && connector.id !== "injected",
    ) &&
    !(window as Window & { ethereum?: unknown }).ethereum;
  const named = connectors.some(
    (connector) => connector.type === "injected" && connector.id !== "injected",
  );
  const listed = [
    ...connectors.filter((connector) => connector.type === "injected"),
    ...connectors.filter((connector) => connector.type !== "injected"),
  ].filter(
    (connector) =>
      !(connector.id === "injected" && named) &&
      (!mobile || connector.type !== "injected"),
  );
  const label = (connector: Connector) =>
    connector.id === "injected"
      ? "Browser wallet"
      : connector.id === "coinbaseWalletSDK"
        ? mobile
          ? "Coinbase Smart Wallet"
          : "Coinbase Wallet"
        : connector.name;
  const connect = async (connector: Connector) => {
    setError("");
    try {
      await connectAsync({ connector });
      onClose();
    } catch (cause) {
      setError(
        /rejected|denied|cancel/i.test(String(cause))
          ? "Connection declined. Choose a wallet to try again."
          : connector.id === "injected"
            ? "No browser wallet found. Install a wallet extension, or use Coinbase Wallet."
            : "Unable to open this wallet. Check the app and try again.",
      );
    }
  };
  return (
    <Modal
      title={isConnected ? "Your wallet" : "Connect a wallet"}
      onClose={onClose}
      className="wallet-sheet"
    >
      {isConnected && address ? (
        <>
          <p className="muted">Points belong to this address.</p>
          <p className="full-address">{getAddress(address)}</p>
          <button
            className="secondary wide"
            onClick={() => {
              disconnect();
              onClose();
            }}
          >
            Disconnect wallet
          </button>
        </>
      ) : (
        <>
          <p className="muted modal-intro">
            Your wallet keeps your score. Nothing to pay.
          </p>
          <div className="wallet-list">
            {mobile &&
              openIn.map((wallet) => (
                <a
                  key={wallet.id}
                  className="wallet-row"
                  href={wallet.href(location.href)}
                >
                  <img
                    src={`./wallets/${wallet.id}.svg`}
                    width={28}
                    height={28}
                    alt=""
                  />
                  <span>Open in {wallet.name}</span>
                  <Icon name="external" size={18} />
                </a>
              ))}
            {listed.map((connector) => (
              <button
                className="wallet-row"
                key={connector.uid}
                onClick={() => void connect(connector)}
                disabled={isPending}
              >
                {connector.icon ? (
                  <img src={connector.icon} width={28} height={28} alt="" />
                ) : connector.id === "coinbaseWalletSDK" ? (
                  <img
                    src="./wallets/coinbase.svg"
                    width={28}
                    height={28}
                    alt=""
                  />
                ) : (
                  <span className="browser-wallet-icon">
                    <Icon name="wallet" size={24} />
                  </span>
                )}
                <span>
                  {label(connector)}
                  {isPending && variables?.connector === connector
                    ? " · opening…"
                    : ""}
                </span>
                <Icon name="chevron" size={18} />
              </button>
            ))}
          </div>
          <p role="status" className="error-message">
            {error}
          </p>
          <p className="wallet-foot">
            <Icon name="shield" size={18} /> No tokens. No fees. Just points.
          </p>
        </>
      )}
    </Modal>
  );
}
