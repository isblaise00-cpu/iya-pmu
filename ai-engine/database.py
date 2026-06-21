"""
Modèles SQLAlchemy — miroir du schéma Prisma (MySQL).
Race et Pronostic simplifiés : plus de Horse séparé.
Pronostic.horses    : [{num, nom, cote_pt, cote_tm}]
Pronostic.proposals : 10 propositions Claude
Result.arrival_order: [n1, n2, n3, ...]
"""
import os
from sqlalchemy.ext.asyncio import AsyncAttrs, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, Text, JSON, ForeignKey, select, UniqueConstraint, Index
from sqlalchemy.sql import func

DATABASE_URL = (
    os.getenv("DATABASE_URL", "mysql://root:@localhost:3306/pmu_db")
    .replace("mysql://", "mysql+aiomysql://", 1)
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(AsyncAttrs, DeclarativeBase):
    pass


class Race(Base):
    __tablename__ = "races"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    date       = Column(Date, nullable=False, unique=True)
    race_type  = Column("raceType", String(20))
    race_name  = Column("raceName", String(255))
    hippodrome = Column(String(255))
    distance   = Column(Integer)
    num_horses = Column("numHorses", Integer)
    start_time = Column("startTime", String(10))
    pdf_url    = Column("pdfUrl", String(500))
    pronostic  = relationship("Pronostic", back_populates="race", cascade="all, delete-orphan", uselist=False)


class Pronostic(Base):
    __tablename__ = "pronostics"
    id                = Column(Integer, primary_key=True, autoincrement=True)
    date              = Column(Date, nullable=False)
    horses            = Column(JSON)       # [{num, nom, cote_pt, cote_tm}]
    proposals         = Column(JSON)       # 10 propositions
    commentary        = Column(Text)
    is_sent           = Column("isSent", Boolean, default=False)
    modified_by_admin = Column("modifiedByAdmin", Boolean, default=False)
    race_id           = Column("raceId", Integer, ForeignKey("races.id"), unique=True)
    race              = relationship("Race", back_populates="pronostic")


class Result(Base):
    __tablename__ = "results"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    date           = Column(DateTime, server_default=func.now())
    arrival_order  = Column("arrivalOrder", JSON)
    source         = Column(String(500))
    pronostic_id   = Column("pronosticId", Integer, ForeignKey("pronostics.id"), unique=True)
    created_at     = Column("createdAt", DateTime, server_default=func.now())


class Setting(Base):
    __tablename__ = "settings"
    key   = Column(String(255), primary_key=True)
    value = Column(String(1000))


# ─── Multi-sports (football + basketball) ───────────────────────────────────

class SportEvent(Base):
    __tablename__ = "sport_events"
    __table_args__ = (
        UniqueConstraint("sport", "externalId", name="uq_sport_event_external"),
        Index("ix_sport_events_sport_date", "sport", "date"),
    )
    id          = Column(Integer, primary_key=True, autoincrement=True)
    sport       = Column(String(20), nullable=False)
    date        = Column(Date, nullable=False)
    league      = Column(String(100), nullable=False)
    home_team   = Column("homeTeam", String(100), nullable=False)
    away_team   = Column("awayTeam", String(100), nullable=False)
    kickoff     = Column(String(5), nullable=False)
    external_id = Column("externalId", String(100), nullable=False)
    created_at  = Column("createdAt", DateTime, server_default=func.now())

    pronostic   = relationship("SportPronostic", back_populates="event", uselist=False)
    result      = relationship("SportResult", back_populates="event", uselist=False)


class SportPronostic(Base):
    __tablename__ = "sport_pronostics"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    event_id          = Column("eventId", Integer, ForeignKey("sport_events.id"), unique=True, nullable=False)
    sport             = Column(String(20), nullable=False)
    date              = Column(Date, nullable=False)
    model_probs       = Column("modelProbs", JSON, nullable=False)
    predictions       = Column(JSON, nullable=False)
    value_bets        = Column("valueBets", JSON, nullable=False)
    commentary        = Column(Text, nullable=False)
    confidence        = Column(Integer, nullable=False)
    is_sent           = Column("isSent", Boolean, default=False)
    modified_by_admin = Column("modifiedByAdmin", Boolean, default=False)
    created_at        = Column("createdAt", DateTime, server_default=func.now())

    event             = relationship("SportEvent", back_populates="pronostic")


class SportResult(Base):
    __tablename__ = "sport_results"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    event_id   = Column("eventId", Integer, ForeignKey("sport_events.id"), unique=True, nullable=False)
    sport      = Column(String(20), nullable=False)
    home_score = Column("homeScore", Integer, nullable=True)
    away_score = Column("awayScore", Integer, nullable=True)
    outcome    = Column(String(10), nullable=True)
    source     = Column(String(255), nullable=True)
    created_at = Column("createdAt", DateTime, server_default=func.now())

    event      = relationship("SportEvent", back_populates="result")


async def get_setting(key: str, default: str = "") -> str:
    async with AsyncSessionLocal() as session:
        row = (await session.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
        return row.value if row else default
