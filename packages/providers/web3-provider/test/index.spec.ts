import "mocha";
import { expect } from "chai";

import Web3 from "web3";
import { BigNumber, providers, utils } from "ethers";
import { TestNetwork } from "ethereum-test-network";
import {
  ERC20Token__factory,
  _abi,
  _bytecode,
} from "ethereum-test-network/lib/utils/ERC20Token__factory";

import { WalletClient } from "./shared";

import WalletConnectProvider from "../src";

const CHAIN_ID = 123;
const PORT = 8547;
const RPC_URL = `http://localhost:${PORT}`;
const ACCOUNTS = {
  a: {
    balance: utils.parseEther("5").toHexString(),
    address: "0xaaE062157B53077da1414ec3579b4CBdF7a4116f",
    privateKey: "0xa3dac6ca0b1c61f5f0a0b3a0acf93c9a52fd94e8e33d243d3b3a8b8c5dc37f0b",
  },
  b: {
    balance: utils.parseEther("1").toHexString(),
    address: "0xa5961EaaF8f5F1544c8bA79328A704bffb6e47CF",
    privateKey: "0xa647cd9040eddd8cd6e0bcbea3154f7c1729e3258ba8f6e555f1e516c9dbfbcc",
  },
};

const TEST_PROVIDER_OPTS = {
  chainId: CHAIN_ID,
  qrcode: false,
  bridge: "https://polygon.bridge.walletconnect.org",
  rpc: {
    [CHAIN_ID]: RPC_URL,
  },
};

const TEST_WALLET_CLIENT_OPTS = {
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  privateKey: ACCOUNTS.a.privateKey,
};

const TEST_ETH_TRANSFER = {
  from: ACCOUNTS.a.address,
  to: ACCOUNTS.b.address,
  value: utils.parseEther("1").toHexString(),
};

describe("WalletConnectProvider", function() {
  this.timeout(30_000);
  let testNetwork: TestNetwork;
  before(async () => {
    testNetwork = await TestNetwork.init({
      chainId: CHAIN_ID,
      port: PORT,
      genesisAccounts: [ACCOUNTS.a, ACCOUNTS.b],
    });
  });
  after(async () => {
    await testNetwork.close();
  });
  it("instantiate successfully", () => {
    const provider = new WalletConnectProvider(TEST_PROVIDER_OPTS);
    expect(!!provider).to.be.true;
  });
  describe("Web3", () => {
    let provider: WalletConnectProvider;
    let walletClient: WalletClient;
    let walletAddress: string;
    let receiverAddress: string;
    let web3: Web3;
    before(async () => {
      provider = new WalletConnectProvider(TEST_PROVIDER_OPTS);
      walletClient = new WalletClient(provider, TEST_WALLET_CLIENT_OPTS);
      walletAddress = walletClient.signer.address;
      receiverAddress = ACCOUNTS.b.address;
      expect(walletAddress).to.eql(ACCOUNTS.a.address);
      const providerAccounts = await provider.enable();
      expect(providerAccounts).to.eql([walletAddress]);
      web3 = new Web3(provider as any);
    });
    it("is enabled", async () => {
      const accounts = await web3.eth.getAccounts();
      expect(accounts).to.eql([walletAddress]);
      const chainId = await web3.eth.getChainId();
      expect(chainId).to.eql(CHAIN_ID);
    });
    it("ERC20 contract", async () => {
      const erc20Factory = new web3.eth.Contract(JSON.parse(JSON.stringify(_abi)));
      const erc20 = await erc20Factory
        .deploy({ data: _bytecode, arguments: ["The test token", "tst", 18] })
        .send({ from: walletAddress });
      const balanceToMint = utils.parseEther("2");
      const mintTx = erc20.methods.mint(walletAddress, balanceToMint.toHexString());
      await mintTx.send({ from: walletAddress });
      const balance = await erc20.methods.balanceOf(walletAddress).call();
      expect(BigNumber.from(balance).toString()).to.eql(balanceToMint.toString());
      const transferTx = erc20.methods.transfer(
        receiverAddress,
        utils.parseEther("1").toHexString(),
      );
      const tokenTransferGas = await transferTx.estimateGas({ from: walletAddress });
      expect(tokenTransferGas.toString()).to.eql("52437");
      await transferTx.send({ from: walletAddress });
      // FIXME: balance A is still 2 after transferring 1
      // const tokenBalanceA = await erc20.methods.balanceOf(walletAddress).call();
      // expect(tokenBalanceA).to.eql(utils.parseEther("1").toString());
      const tokenBalanceB = await erc20.methods.balanceOf(receiverAddress).call();
      expect(tokenBalanceB).to.eql(utils.parseEther("1").toString());
    });
    it.skip("revert call", () => {
      // TODO: write test
    });
    it.skip("revert tx", () => {
      // TODO: write test
    });
    it.skip("estimate gas", async () => {
      const ethTransferGas = await web3.eth.estimateGas(TEST_ETH_TRANSFER);
      // FIXME: returning 21001 instead of 21000
      expect(ethTransferGas.toString()).to.eql("21000");
    });
    it.skip("send transaction", async () => {
      const balanceBefore = BigNumber.from(await web3.eth.getBalance(walletAddress));
      await web3.eth.sendTransaction(TEST_ETH_TRANSFER);
      const balanceAfter = BigNumber.from(await web3.eth.getBalance(walletAddress));
      expect(balanceAfter.lt(balanceBefore)).to.be.true;
    });
    it.skip("sign transaction", async () => {
      const balanceBefore = BigNumber.from(await web3.eth.getBalance(walletAddress));
      // FIXME: never resolves and times out
      const signedTx = await web3.eth.signTransaction(TEST_ETH_TRANSFER);
      const broadcastTx = await web3.eth.sendSignedTransaction(signedTx.raw);
      expect(!!broadcastTx).to.be.true;
      const balanceAfter = BigNumber.from(await web3.eth.getBalance(walletAddress));
      expect(balanceAfter.lt(balanceBefore)).to.be.true;
    });
    it.skip("sign message", async () => {
      const msg = "Hello world";
      const signature = await web3.eth.sign(msg, walletAddress);
      // FIXME: needs to be handled because of inconsistency between eth_sign and personal_sign
      const verify = utils.verifyMessage(msg, signature);
      expect(verify).eq(walletAddress);
    });
  });
  describe("Ethers", () => {
    let provider: WalletConnectProvider;
    let walletClient: WalletClient;
    let walletAddress: string;
    let receiverAddress: string;
    let web3Provider: providers.Web3Provider;
    before(async () => {
      provider = new WalletConnectProvider(TEST_PROVIDER_OPTS);
      walletClient = new WalletClient(provider, TEST_WALLET_CLIENT_OPTS);
      walletAddress = walletClient.signer.address;
      receiverAddress = ACCOUNTS.b.address;
      expect(walletAddress).to.eql(ACCOUNTS.a.address);
      const providerAccounts = await provider.enable();
      expect(providerAccounts).to.eql([walletAddress]);
      web3Provider = new providers.Web3Provider(provider);
    });
    it("is enabled", async () => {
      const accounts = await web3Provider.listAccounts();
      expect(accounts).to.eql([walletAddress]);
      const network = await web3Provider.getNetwork();
      expect(network.chainId).to.equal(CHAIN_ID);
    });
    it("ERC20 contract", async () => {
      const signer = web3Provider.getSigner();
      const erc20Factory = new ERC20Token__factory(signer as any);
      const erc20 = await erc20Factory.deploy("The test token", "tst", 18);
      await erc20.deployed();
      const balanceToMint = utils.parseEther("2");
      const mintTx = await erc20.mint(walletAddress, balanceToMint);
      await mintTx.wait();
      const tokenBalance = await erc20.balanceOf(walletAddress);
      expect(tokenBalance.toString()).to.eql(balanceToMint.toString());
      const tokenTransferGas = await erc20.estimateGas.transfer(
        receiverAddress,
        utils.parseEther("1"),
      );
      expect(tokenTransferGas.toString()).to.eql("52437");
      const transferTx = await erc20.transfer(receiverAddress, utils.parseEther("1"));
      await transferTx.wait();
      // FIXME: balance A is still 2 after transferring 1
      // const tokenBalanceA = await erc20.balanceOf(walletAddress);
      // expect(tokenBalanceA.toString()).to.eql(utils.parseEther("1").toString());
      const tokenBalanceB = await erc20.balanceOf(receiverAddress);
      expect(tokenBalanceB.toString()).to.eql(utils.parseEther("1").toString());
    });
    it.skip("revert call", () => {
      // TODO: write test
    });
    it.skip("revert tx", () => {
      // TODO: write test
    });
    it.skip("estimate gas", async () => {
      const ethTransferGas = await web3Provider.estimateGas(TEST_ETH_TRANSFER);
      // FIXME: returning 21001 instead of 21000
      expect(ethTransferGas.toString()).to.eql("21000");
    });
    it("send transaction", async () => {
      const balanceBefore = await web3Provider.getBalance(walletAddress);
      const signer = web3Provider.getSigner();

      const transferTx = await signer.sendTransaction(TEST_ETH_TRANSFER);

      await transferTx.wait(2);

      expect(!!transferTx.hash).to.be.true;
      const balanceAfter = await web3Provider.getBalance(walletAddress);
      expect(
        balanceAfter.lt(balanceBefore),
        "balanceAfter " +
          balanceAfter.toString() +
          " less then balanceBefore: " +
          balanceBefore.toString(),
      ).to.be.true;
    });
    it.skip("sign transaction", async () => {
      const signer = web3Provider.getSigner();
      const balanceBefore = await web3Provider.getBalance(walletAddress);
      // FIXME: ethers does not support signTransaction but also does not resolve sendAsyncPromise
      const signedTx = await signer.signTransaction(TEST_ETH_TRANSFER); // ERROR "signing transactions is unsupported (operation=\"signTransaction\", code=UNSUPPORTED_OPERATION, version=providers/5.1.0)"
      // const signedTx = await provider.sendAsyncPromise("eth_signTransaction", [unsignedTx]); // ERROR Does not resolve
      const broadcastTx = await provider.request({
        method: "eth_sendRawTransaction",
        params: [signedTx],
      });
      expect(!!broadcastTx).to.be.true;
      const balanceAfter = await web3Provider.getBalance(walletAddress);
      expect(balanceAfter.lt(balanceBefore)).to.be.true;
    });
    it.skip("sign message", async () => {
      const signer = web3Provider.getSigner();
      const msg = "Hello world";
      const signature = await signer.signMessage(msg);
      // FIXME: needs to be handled because of inconsistency between eth_sign and personal_sign
      const verify = utils.verifyMessage(msg, signature);
      expect(verify).eq(walletAddress);
    });
  });
});
