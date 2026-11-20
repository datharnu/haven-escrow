# Spikes

2026-11-20. SpikeTarget is not part of Haven Escrow. It checks three things the escrow depends on: a relayer with no authority can submit an ML-DSA-87 authorisation, whether a scoped window allows a contract to create another contract, and whether a classical secp256k1 key can act alone.

Owner of the spike contract: escrow-client `0xb911fd43fc85826947d1e11084e594f8b9d466bf`. Contract: `0xe11fe2bb1ad13ab116e0d362b218ef1b2330b1a7`.

## S1 Deploy

spike deployed SpikeTarget in an unscoped window. Create `0xac057fd48140b66e250f248bb0e4035820d8679e1629bdfd42f964cd333ee358`, gas used 448701, fee 50479 uqor. Window open `B75782C6D6BC417A402DB20BE222D2FA77128112E6DEB12CAC5BC9A19861C896`, close `A5B9D870B49C0E57663F7915402003A5E4FB11F498787C157AA51AF20F441F77`.

## S2 Relayer

escrow-freelancer submitted escrow-client's ML-DSA-87 ping and the ping count became 1. Ping `0x836195008261eacffef0b0ffc91dcb44271588178bb790ea649f65b28b60f8cd`. The same signature sent again reverted `SignatureInvalid` in `0xd5634f54f8673f85fc30db6be66571e283c8e0c247ffaf3d293cfb87551830ac`. Window open `17AC0B78811C7A0326E01A088F97C1A9D2ECB45AB9357C3A2372AB2B0589A568`, close `15DF8DC39C2621ED23EBC3C1C31E944910D6BF150C8B2563BBC07095F63D7C9D`.
The ping and the replay are in two windows. The first run could not read the revert data, so it closed the window without sending the replay.

## S3 Create inside a call

Outcome: succeeded. success
Transaction `0xa0021315f5db9a2fd875749e20412914563fbadc681ab3da3deada90716dc2e0`.
Window open `5283FFA25EC5185B1371C246B26CD5192C380CE06C76CCC475C7BC81C9F1E80D`, close `ACBBA71AA65C8D5D666A950BD712ADBF38A8E569DDF30B3C753A36959147C35D`.
Phase 4 follows this result: EscrowFactory.create runs in a scoped window [factory].

## S4 Classical key alone

The sender held only escrow-client's secp256k1 key.
No window was open. Sending ping with a 4627-byte zero signature was refused. No transaction hash was produced. The node said: failed to broadcast transaction: account qor1hygl6sluskpxj373uyggfev5lzuage4l69zv9q has no open EVM authorisation window; open one with MsgOpenEVMWindow, signed on the Cosmos lane with the account's post-quantum key.
A classically signed MsgOpenEVMWindow was refused. Broadcasting transaction failed with code 20 (codespace: pqc). Log: account qor1hygl6sluskpxj373uyggfev5lzuage4l69zv9q has a registered PQC key and must include the hybrid signature extension (hybrid mode: required): hybrid PQC signature required

## S5 Gas

- S1 deploy: gas used 448701, effective gas price 112500000000 wei, fee 50479 uqor, tx `0xac057fd48140b66e250f248bb0e4035820d8679e1629bdfd42f964cd333ee358`.
- S2 ping: gas used 242549, effective gas price 112500000000 wei, fee 27287 uqor, tx `0x836195008261eacffef0b0ffc91dcb44271588178bb790ea649f65b28b60f8cd`.
- S2 replay: gas used 750000, effective gas price 112500000000 wei, fee 84375 uqor, tx `0xd5634f54f8673f85fc30db6be66571e283c8e0c247ffaf3d293cfb87551830ac`.
- S3 spawn: gas used 64923, effective gas price 112500000000 wei, fee 7304 uqor, tx `0xa0021315f5db9a2fd875749e20412914563fbadc681ab3da3deada90716dc2e0`.
- S1 deploy window spent 50479 uqor of a 5000000 uqor cap. Open `B75782C6D6BC417A402DB20BE222D2FA77128112E6DEB12CAC5BC9A19861C896`, close `A5B9D870B49C0E57663F7915402003A5E4FB11F498787C157AA51AF20F441F77`.
- S2 replay window spent 382500 uqor of a 2000000 uqor cap. Open `453A2ADB52E4E7E195A85EE0DEA58B14504DF8FD2AA56CC78C148E9EC77DDF31`, close `E8D5681214AF6E4A216A5164C91DD24F614671720F0E8BFB59DB66955ECF07A2`.
- S3 spawn window spent 16587 uqor of a 2000000 uqor cap. Open `5283FFA25EC5185B1371C246B26CD5192C380CE06C76CCC475C7BC81C9F1E80D`, close `ACBBA71AA65C8D5D666A950BD712ADBF38A8E569DDF30B3C753A36959147C35D`.

