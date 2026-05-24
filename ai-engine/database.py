import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase, relationship
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, JSON, Text, ForeignKey, Enum as SAEnum, UniqueConstraint
from datetime import datetime
import enum

DATABASE_URL = os.getenv("DATABASE_URL", "mysql://root:@localhost:3306/pmu_db")
ASYNC_DATABASE_URL = DATABASE_URL.replace("mysql://", "mysql+aiomysql://")

engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class RaceType(str, enum.Enum):
    TIERCE = "TIERCE"
    QUARTE = "QUARTE"
    QUARTE_PLUS = "QUARTE_PLUS"
    QUINTE_PLUS = "QUINTE_PLUS"
    COUPLE = "COUPLE"
    AUTRE = "AUTRE"


class Discipline(str, enum.Enum):
    TROT_ATTELE = "TROT_ATTELE"
    TROT_MONTE = "TROT_MONTE"
    PLAT = "PLAT"
    OBSTACLE = "OBSTACLE"
    AUTRE = "AUTRE"


class Race(Base):
    __tablename__ = "races"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, unique=True, nullable=False)
    race_type = Column('raceType', SAEnum(RaceType), nullable=False)
    discipline = Column(SAEnum(Discipline), nullable=False)
    race_name = Column('raceName', String(255), nullable=False)
    hippodrome = Column(String(255), nullable=False)
    country = Column(String(50), default="FR")
    distance = Column(Integer, nullable=False)
    num_horses = Column('numHorses', Integer, nullable=False)
    start_time = Column('startTime', DateTime, nullable=True)
    allocation_xof = Column('allocationXof', Integer, nullable=True)
    pdf_url = Column('pdfUrl', String(500), nullable=True)
    pdf_fetched_at = Column('pdfFetchedAt', DateTime, nullable=True)
    raw_pdf_text = Column('rawPdfText', Text, nullable=True)
    created_at = Column('createdAt', DateTime, default=datetime.utcnow)
    updated_at = Column('updatedAt', DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    horses = relationship("Horse", back_populates="race", cascade="all, delete-orphan")


class Horse(Base):
    __tablename__ = "horses"
    __table_args__ = (UniqueConstraint('raceId', 'number', name='horses_raceId_number_key'),)
    id = Column(Integer, primary_key=True, index=True)
    race_id = Column('raceId', Integer, ForeignKey('races.id', ondelete='CASCADE'), nullable=False)
    number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    driver = Column(String(255), nullable=True)
    trainer = Column(String(255), nullable=True)
    owner = Column(String(255), nullable=True)
    sex = Column(String(10), nullable=True)
    age = Column(Integer, nullable=True)
    distance = Column(Integer, nullable=True)
    chrono = Column(String(50), nullable=True)
    recent_perf = Column('recentPerf', String(100), nullable=True)
    gains_xof = Column('gainsXof', Integer, nullable=True)
    odds_paris_turf = Column('oddsParisTurf', String(20), nullable=True)
    odds_tierce_mag = Column('oddsTierceMag', String(20), nullable=True)
    external_data = Column('externalData', JSON, nullable=True)

    race = relationship("Race", back_populates="horses")


class Pronostic(Base):
    __tablename__ = "pronostics"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.utcnow)
    base_horse = Column('baseHorse', String(500), nullable=True)
    tierce = Column(JSON, nullable=True)
    quarte = Column(JSON, nullable=True)
    quinte = Column(JSON, nullable=True)
    outsider = Column(String(500), nullable=True)
    confidence_score = Column('confidenceScore', Integer, default=0)
    commentary = Column(Text, nullable=True)
    raw_data = Column('rawData', JSON, nullable=True)
    is_sent = Column('isSent', Boolean, default=False)
    modified_by_admin = Column('modifiedByAdmin', Boolean, default=False)
    created_at = Column('createdAt', DateTime, default=datetime.utcnow)
    race_id = Column('raceId', Integer, ForeignKey('races.id', ondelete='SET NULL'), nullable=True, unique=True)
    proposals = Column(JSON, nullable=True)
    sources_pdf = Column('sourcesPdf', JSON, nullable=True)


class Result(Base):
    __tablename__ = "results"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.utcnow)
    arrival_order = Column('arrivalOrder', JSON)
    source = Column(String(255), nullable=True)
    pronostic_id = Column('pronosticId', Integer, nullable=True)
    created_at = Column('createdAt', DateTime, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"
    key = Column(String(255), primary_key=True)
    value = Column(String(1000))


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_setting(session: AsyncSession, key: str, default: str = "") -> str:
    from sqlalchemy import select
    result = await session.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting else default
