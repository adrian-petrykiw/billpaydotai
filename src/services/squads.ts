// src/utils/squads.ts
import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  instructions,
  types,
  generated,
  utils,
  PROGRAM_ID,
} from "@sqds/multisig";

export function transactionMessageToVaultMessage(
  message: TransactionMessage,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  vaultPda: PublicKey
): types.TransactionMessage {
  const messageBytes =
    utils.transactionMessageToMultisigTransactionMessageBytes({
      message,
      addressLookupTableAccounts,
      vaultPda,
    });

  const [compiledMessage] = types.transactionMessageBeet.deserialize(
    Buffer.from(messageBytes)
  );

  return compiledMessage;
}

export async function getAccountsForExecute(
  connection: Connection,
  multisigPda: PublicKey,
  message: types.TransactionMessage,
  ephemeralSignerBumps: number[],
  vaultIndex: number,
  transactionPda: PublicKey,
  programId: PublicKey = PROGRAM_ID
): Promise<{
  accountMetas: AccountMeta[];
  lookupTableAccounts: AddressLookupTableAccount[];
}> {
  const [vaultPda] = getVaultPda(multisigPda, vaultIndex, programId);
  const ephemeralSignerPdas = getEphemeralSignerPdas(
    transactionPda,
    ephemeralSignerBumps,
    programId
  );
  const lookupTables = await getLookupTables(connection, message);

  return {
    accountMetas: buildAccountMetas(
      message,
      lookupTables,
      vaultPda,
      ephemeralSignerPdas
    ),
    lookupTableAccounts: [...lookupTables.values()],
  };
}

export function createExecuteInstruction(
  multisigPda: PublicKey,
  transactionIndex: bigint,
  member: PublicKey,
  accountsForExecute: AccountMeta[],
  altAccounts: AddressLookupTableAccount[] = [],
  programId: PublicKey = PROGRAM_ID
): {
  instruction: TransactionInstruction;
  lookupTableAccounts: AddressLookupTableAccount[];
} {
  const [proposalPda] = getProposalPda(
    multisigPda,
    transactionIndex,
    programId
  );
  const [transactionPda] = getTransactionPda(
    multisigPda,
    transactionIndex,
    programId
  );

  return {
    instruction: generated.createVaultTransactionExecuteInstruction(
      {
        multisig: multisigPda,
        member,
        proposal: proposalPda,
        transaction: transactionPda,
        anchorRemainingAccounts: accountsForExecute,
      },
      programId
    ),
    lookupTableAccounts: altAccounts,
  };
}

// Helper functions
function getVaultPda(
  multisigPda: PublicKey,
  index: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), multisigPda.toBuffer(), Buffer.from([index])],
    programId
  );
}

function getProposalPda(
  multisigPda: PublicKey,
  transactionIndex: bigint,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal"),
      multisigPda.toBuffer(),
      bigintToBuffer(transactionIndex),
    ],
    programId
  );
}

function getTransactionPda(
  multisigPda: PublicKey,
  index: bigint,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("transaction"), multisigPda.toBuffer(), bigintToBuffer(index)],
    programId
  );
}

function getEphemeralSignerPdas(
  transactionPda: PublicKey,
  bumps: number[],
  programId: PublicKey
): PublicKey[] {
  return bumps.map(
    (_, index) =>
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("ephemeral"),
          transactionPda.toBuffer(),
          Buffer.from([index]),
        ],
        programId
      )[0]
  );
}

async function getLookupTables(
  connection: Connection,
  message: types.TransactionMessage
): Promise<Map<string, AddressLookupTableAccount>> {
  const lookupPromises = message.addressTableLookups.map(
    async ({ accountKey }) => {
      const { value } = await connection.getAddressLookupTable(accountKey);
      if (!value)
        throw new Error(`Lookup table ${accountKey.toBase58()} not found`);
      return [accountKey.toBase58(), value] as const;
    }
  );

  return new Map(await Promise.all(lookupPromises));
}

function buildAccountMetas(
  message: types.TransactionMessage,
  lookupTables: Map<string, AddressLookupTableAccount>,
  vaultPda: PublicKey,
  ephemeralSignerPdas: PublicKey[]
): AccountMeta[] {
  const metas: AccountMeta[] = [];

  // Add lookup table accounts
  message.addressTableLookups.forEach(({ accountKey }) => {
    metas.push({ pubkey: accountKey, isSigner: false, isWritable: false });
  });

  // Add static accounts
  message.accountKeys.forEach((accountKey, index) => {
    metas.push({
      pubkey: accountKey,
      isWritable: isWritableIndex(message, index),
      isSigner:
        isSignerIndex(message, index) &&
        !accountKey.equals(vaultPda) &&
        !ephemeralSignerPdas.some((pda) => accountKey.equals(pda)),
    });
  });

  // Process lookup table accounts
  addLookupTableAccounts(message, lookupTables, metas);

  return metas;
}

function isSignerIndex(
  message: types.TransactionMessage,
  index: number
): boolean {
  return index < message.numSigners;
}

function isWritableIndex(
  message: types.TransactionMessage,
  index: number
): boolean {
  if (index >= message.accountKeys.length) return false;
  const { numSigners, numWritableSigners, numWritableNonSigners } = message;
  if (index < numWritableSigners) return true;
  if (index >= numSigners) return index - numSigners < numWritableNonSigners;
  return false;
}

function addLookupTableAccounts(
  message: types.TransactionMessage,
  lookupTables: Map<string, AddressLookupTableAccount>,
  metas: AccountMeta[]
): void {
  message.addressTableLookups.forEach((lookup) => {
    const table = lookupTables.get(lookup.accountKey.toBase58());
    if (!table)
      throw new Error(`Missing lookup table: ${lookup.accountKey.toBase58()}`);

    lookup.writableIndexes.forEach((index) => {
      const pubkey = table.state.addresses[index];
      if (!pubkey) throw new Error(`Invalid lookup table index: ${index}`);
      metas.push({ pubkey, isWritable: true, isSigner: false });
    });

    lookup.readonlyIndexes.forEach((index) => {
      const pubkey = table.state.addresses[index];
      if (!pubkey) throw new Error(`Invalid lookup table index: ${index}`);
      metas.push({ pubkey, isWritable: false, isSigner: false });
    });
  });
}

function bigintToBuffer(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(16, "0"), "hex");
}
