from pydantic import BaseModel, Field


class CharacterGenerateRequest(BaseModel):
    description: str = Field(..., description="角色描述或名字")
    style: str = "manga comic style"
    existing_name: str | None = None


class CharacterGenerateResponse(BaseModel):
    name: str
    description: str
    personality: str
    catchphrase: str = ""
    sample_dialogues: list[str] = Field(default_factory=list)
    style: str
    image_prompt: str


class CharacterBrief(BaseModel):
    name: str = ""
    description: str = ""
    personality: str = ""


class PreviousEpisodeBrief(BaseModel):
    episode_number: int = 1
    title: str = ""
    synopsis: str = ""
    script: str = ""


class EpisodeScriptRequest(BaseModel):
    episode_number: int = 1
    synopsis: str = ""
    characters: list[CharacterBrief] = Field(default_factory=list)
    previous_episodes: list[PreviousEpisodeBrief] = Field(default_factory=list)
    style: str = "manga comic style"


class ComicPanel(BaseModel):
    index: int
    caption: str
    scene: str
    dialogue: str = ""
    characters: list[str] = Field(default_factory=list)
    is_title_page: bool = False


class EpisodeScriptResponse(BaseModel):
    title: str
    synopsis: str
    script: str
    panels: list[ComicPanel]


class EpisodeReviseRequest(BaseModel):
    episode_number: int = 1
    revision: str = ""
    current_title: str = ""
    current_synopsis: str = ""
    current_script: str = ""
    characters: list[CharacterBrief] = Field(default_factory=list)
    previous_episodes: list[PreviousEpisodeBrief] = Field(default_factory=list)
    style: str = "manga comic style"
