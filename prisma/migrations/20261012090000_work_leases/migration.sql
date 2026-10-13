-- Short-lived named leases that serialize work across processes without holding a DB connection.
CREATE TABLE "work_leases" (
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_leases_pkey" PRIMARY KEY ("key")
);
