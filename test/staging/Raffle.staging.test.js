const { assert, expect } = require("chai");
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat-config");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, raffleEntranceFee, deployer;

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;

              raffle = await ethers.getContract("Raffle", deployer);

              raffleEntranceFee = await raffle.getEntranceFee();
          });

          describe("fulfillRandomWords", function () {
              it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
                  //enter the raffle
                  console.log("Setting up test...");
                  const startingTimestamp = await raffle.getLatestTimestamp();
                  const accounts = await ethers.getSigners();
                  // setup listener before we enter the raffle
                  // Just in case the blockchain moves really fast
                  console.log("Setting up Listener...");
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event fired!");
                          try {
                              // add our asserts here
                              const recentWinner =
                                  await raffle.getRecentWinner();
                              const raffleState = await raffle.getRaffleState();
                              const winnerEndingBalance =
                                  await accounts[0].getBalance();
                              const endingTimestamp =
                                  await raffle.getLatestTimestamp();

                              await expect(raffle.getPlayer(0)).to.be.reverted;
                              assert.equal(
                                  recentWinner.toString(),
                                  accounts[0].address
                              );
                              assert.equal(raffleState.toString(), "0");
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance
                                      .add(raffleEntranceFee)
                                      .toString()
                              );
                              assert(endingTimestamp > startingTimestamp);
                              console.log("before resolve");
                              resolve();
                          } catch (e) {
                              console.error(e);
                              reject(e);
                          }
                      });

                      console.log("Entering Raffle...");
                      // Then enter the raffle
                      const tx = await raffle.enterRaffle({
                          value: raffleEntranceFee,
                      });
                      await tx.wait(1);
                      console.log("Time to wait");
                      const winnerStartingBalance =
                          await accounts[0].getBalance();
                      // and this code WONT complete until our listener has finished listening!!!
                  });
              });
          });
      });
