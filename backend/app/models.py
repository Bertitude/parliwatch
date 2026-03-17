from sqlalchemy import (
    Column, String, Integer, Float, Boolean,
    DateTime, Text, JSON, ForeignKey
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    youtube_url = Column(String, nullable=False)
    video_id = Column(String, nullable=False, index=True)
    title = Column(String)
    channel = Column(String)
    duration = Column(Integer)
    thumbnail_url = Column(String)
    upload_date = Column(String)
    is_live = Column(Boolean, default=False)
    was_live = Column(Boolean, default=False)
    status = Column(String, default="pending")  # pending|extracting|transcribing|summarizing|complete|failed
    transcript_source = Column(String)
    transcription_tier = Column(String, default="free")
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    segments = relationship("TranscriptSegment", back_populates="session", cascade="all, delete-orphan")
    summary = relationship("Summary", uselist=False, back_populates="session", cascade="all, delete-orphan")
    api_usages = relationship("ApiUsage", back_populates="session", cascade="all, delete-orphan")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    speaker_label = Column(String)
    text = Column(Text, nullable=False)
    confidence = Column(Float)
    source = Column(String)
    is_edited = Column(Boolean, default=False)

    session = relationship("Session", back_populates="segments")


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), unique=True)
    executive_summary = Column(Text)
    topics = Column(JSON)
    decisions = Column(JSON)
    actions = Column(JSON)
    speakers = Column(JSON)
    created_at = Column(DateTime, server_default=func.now())

    session = relationship("Session", back_populates="summary")


class ApiUsage(Base):
    __tablename__ = "api_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"))
    provider = Column(String)
    model = Column(String)
    minutes_processed = Column(Float)
    cost_usd = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    session = relationship("Session", back_populates="api_usages")
