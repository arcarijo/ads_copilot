-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "clerkUserId" TEXT,
    "reportFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "website" TEXT,
    "socialLinksJson" TEXT NOT NULL DEFAULT '[]',
    "gmbUrl" TEXT,
    "metaAdAccountId" TEXT NOT NULL,
    "metaPageId" TEXT NOT NULL,
    "metaSystemUserId" TEXT,
    "metaSystemUserName" TEXT,
    "metaAppId" TEXT,
    "metaAccessToken" TEXT NOT NULL,
    "metaAppToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifyResultJson" TEXT,
    "lastAdminNotifyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAudience" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "metaAudienceId" TEXT,
    "specJson" TEXT NOT NULL DEFAULT '{}',
    "sourceNote" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConnection" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "credsJson" TEXT NOT NULL DEFAULT '{}',
    "directive" TEXT NOT NULL DEFAULT '',
    "directiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileMd" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL DEFAULT '{}',
    "directive" TEXT NOT NULL DEFAULT '',
    "directiveAt" TIMESTAMP(3),
    "marketsJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'META',
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'OUTCOME_LEADS',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "budgetCents" INTEGER NOT NULL,
    "budgetType" TEXT NOT NULL DEFAULT 'DAILY',
    "budgetCeilingCents" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "questionnaireJson" TEXT NOT NULL DEFAULT '{}',
    "audienceJson" TEXT NOT NULL DEFAULT '{}',
    "creativesJson" TEXT NOT NULL DEFAULT '[]',
    "abTest" BOOLEAN NOT NULL DEFAULT false,
    "abVariable" TEXT,
    "abNotes" TEXT,
    "directive" TEXT,
    "directiveAt" TIMESTAMP(3),
    "aiPlanJson" TEXT,
    "clarificationsJson" TEXT,
    "metaCampaignId" TEXT,
    "metaAdSetIdsJson" TEXT NOT NULL DEFAULT '[]',
    "metaAdIdsJson" TEXT NOT NULL DEFAULT '[]',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpaCents" INTEGER,
    "frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detailJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_clerkUserId_idx" ON "Client"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConnection_clientId_platform_key" ON "PlatformConnection"("clientId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_clientId_key" ON "BusinessProfile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_campaignId_date_key" ON "AnalyticsSnapshot"("campaignId", "date");

-- CreateIndex
CREATE INDEX "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "MetaAudience" ADD CONSTRAINT "MetaAudience_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformConnection" ADD CONSTRAINT "PlatformConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

