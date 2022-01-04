import * as hi from 'blindmixer-lib';

if (
  !process.env.CURRENCY ||
  !process.env.CUSTODIAN_SECRET_SEED ||
  !process.env.SECRET_ACK ||
  !process.env.SECRET_FUNDING ||
  !process.env.SECRET_BLINDING ||
  !process.env.WIPEDATE
) {
  throw 'check your parameters!';
}

// more env variables core
if (!process.env.CORE_USER || !process.env.CORE_PASSWORD) {
  throw 'check core params.';
}

// more env variables postgresql
if (!process.env.DATABASE_URL) {
  throw 'check postgresql params';
}

const currency = process.env.CURRENCY || 'tBTC';
const custodianSecretSeed = hi.Buffutils.fromString(process.env.CUSTODIAN_SECRET_SEED);

export const ackSecretKey = computePrivKey(process.env.SECRET_ACK);
export const fundingSecretKey = computePrivKey(process.env.SECRET_FUNDING);
export const blindingSecretKeys: hi.PrivateKey[][] = [];

// you can comment this out as it is optional
export const wipeDate = new Date(process.env.WIPEDATE);

const initialKeys: hi.PrivateKey[] = [];
for (let i = 0; i <= hi.Magnitude.MaxMagnitude; i++) {
  initialKeys.push(computePrivKey(`${process.env.SECRET_BLINDING}_${i}`)); // see _
}
blindingSecretKeys.push(initialKeys)



export let custodianInfo = new hi.CustodianInfo(
  ackSecretKey.toPublicKey(),
  currency,
  fundingSecretKey.toPublicKey(),
  blindingSecretKeys.map((bs) => (bs.map(f => f.toPublicKey()))),
  wipeDate.toISOString()
);



let startingTime = wipeDate.getTime();


// 28 days
const interval = 1000 * 60 * 60 * 24 * 28 //* 60 * 24 * 28

// catch-up if custodian crashed;
let isCatchingUp = true;

// we can also store this instead of regenerating, much faster down the line
while (isCatchingUp) {
  if (Date.now() > startingTime + interval) {
    deriveNewCustodianInfo();
    startingTime = startingTime + interval;
  } else {
    isCatchingUp = false;
  }
  if (!isCatchingUp) {
    blindKeyTimer();
  }
}

function blindKeyTimer() {
  setInterval(async () => {
    if (Date.now() > startingTime + interval) {
      console.log("Updating signing keys live!")
      startingTime = startingTime + interval;
      deriveNewCustodianInfo();
    }
  }, 1000 * 60); // fixed refresh, lazy...
}

function deriveNewCustodianInfo() {
  const newSecretBlindingKeys: hi.PrivateKey[] = [];

  for (let i = 0; i <= hi.Magnitude.MaxMagnitude; i++) {
    newSecretBlindingKeys.push(computePrivKey(`${process.env.SECRET_BLINDING}_${i}_${custodianInfo.blindCoinKeys.length}`));
  }
  blindingSecretKeys.unshift(newSecretBlindingKeys);

  custodianInfo = new hi.CustodianInfo(
    ackSecretKey.toPublicKey(),
    currency,
    fundingSecretKey.toPublicKey(),
    blindingSecretKeys.map((bs) => (bs.map(f => f.toPublicKey()))),
    wipeDate.toISOString()
  );
}

function computePrivKey(prefix: string) {
  const bytes = hi.Hash.fromMessage(prefix, custodianSecretSeed);
  if (bytes instanceof Error) {
    throw bytes;
  }
  const key = hi.PrivateKey.fromBytes(bytes.buffer);
  if (key instanceof Error) {
    throw key;
  }

  return key;
}
