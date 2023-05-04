const { assert, expect } = require("chai");
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat-config");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle,
              vrfCoordinatorV2Mock,
              raffleEntranceFee,
              deployer,
              interval;
          const chainId = network.config.chainId;
          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer
              );
              raffleEntranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("constructor", function () {
              it("initializes the raffle correctly", async function () {
                  // Ideally we make our teest have just 1 assert per "it"
                  const raffleState = await raffle.getRaffleState();
                  assert.equal(raffleState.toString(), "0");
                  assert.equal(
                      interval.toString(),
                      networkConfig[chainId]["interval"]
                  );
              });
          });

          describe("enterRaffle", function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  );
              });
              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const playerFromContract = await raffle.getPlayer(0);
                  assert.equal(playerFromContract, deployer);
              });
              it("emits event on enter", async function () {
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee })
                  ).to.emit(raffle, "RaffleEnter");
              });
              it("doesnt allow entrance, when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  // does the same
                  // await network.provider.request({method:"evm_mine", params:[]})

                  // We pretend to be a chainlink Keeper
                  await raffle.performUpkeep([]);
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee })
                  ).to.be.revertedWith("Raffle__NotOpen");
              });
          });
          describe("CheckUpkeep", function () {
              it("returns false if people haven't send any eth", async function () {
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  );
                  assert(!upkeepNeeded);
              });
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep("0x");
                  const raffleState = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  );
                  assert.equal(raffleState.toString(), "1");
                  assert.equal(upkeepNeeded, false);
              });
              it("returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await raffle.provider.send("evm_increaseTime", [
                      interval.toNumber() - 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  );
                  assert(!upkeepNeeded);
              });
              it("returns true if enough time has passed, has players, eth and is open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  );
                  assert(upkeepNeeded);
              });
          });
          describe("PerformUpkeep", function () {
              it("it can only run, if checkupkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const tx = await raffle.performUpkeep("0x");
                  assert(tx);
              });
              it("reverts when checkupkeep is false", async function () {
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                      `Raffle_UpkeepNotNeeded` // can be string interpolation, when you want keep track of the parameter aswell, like `Raffle_UpkeepNotNeeded(balance, players, etc)`
                  );
              });
              it("updates the raffle state, emits an event, and calls the vrfCoordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
                  const txResponse = await raffle.performUpkeep("0x");
                  const txReceipt = await txResponse.wait(1);
                  const requestId = txReceipt.events[1].args.requestId;
                  const raffleState = await raffle.getRaffleState();
                  assert(requestId > 0);
                  assert(raffleState.toString() == "1");
              });
          });
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]);
                  await network.provider.send("evm_mine", []);
              });
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
              });
              // WAYYYY TOOO BIG
              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3;
                  const startingAccountIndex = 1; // deployer = 0;
                  const accounts = await ethers.getSigners();
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(
                          accounts[i]
                      );
                      await accountConnectedRaffle.enterRaffle({
                          value: raffleEntranceFee,
                      });
                  }
                  const startingTimeStamp = await raffle.getLatestTimestamp();

                  // perform Upkeep (mock beeing chainlink keepers)
                  // fulfillRandomWords (mock beeing the chainlink VRF)
                  // if on testnet, we will have to wait for the fullfil random words to be called
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event!!!");
                          try {
                              const recentWinner =
                                  await raffle.getRecentWinner();
                              const raffleState = await raffle.getRaffleState();

                              const endingTimeStamp =
                                  await raffle.getLatestTimestamp();
                              const numPlayers = await raffle.getNumPlayers();
                              const winnerEndingBalance =
                                  await accounts[1].getBalance();
                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(raffleState.toString(), "0");
                              assert(endingTimeStamp > startingTimeStamp);
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              );
                          } catch (e) {
                              reject(e);
                          }
                          resolve();
                      });
                      // Setting up the listener
                      // below, we will fire the event, and the listener will pick it up and resolve
                      const tx = await raffle.performUpkeep("0x");
                      const txReceipt = await tx.wait(1);
                      const winnerStartingBalance =
                          await accounts[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      );
                  });
              });
          });
      });
