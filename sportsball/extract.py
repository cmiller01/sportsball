import pandas as pd
import soccerdata as sd
import os.path

DATA_DIR = os.path.join(os.path.dirname(__file__), "data/match")

def save_fbref_data(season: int) -> None:
    # only support premier league for now
    fb = sd.FBref(seasons=season, leagues="ENG-Premier League")
    data = fb.read_schedule()
    path = os.path.join(DATA_DIR, f"fbref_{season}.parquet")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data.to_parquet(path)


if __name__ == "__main__":
    # TODO: pull more and/or check current year
    # bug where 2020 and 2021 are same set (covid probs)
    seasons = [2017,2018,2019,2020,2021,2022,2023]
    for season in seasons:
        save_fbref_data(season)