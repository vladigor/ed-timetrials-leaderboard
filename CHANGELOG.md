# Change log
## 2026-08-24
- API:
    - Added tags to the /api/media endpoint
- Activity page
    - Added colour to Position column for entries where the other cmdr is ahead of you

## 2026-07-21
- General:
    - Added [Cafe Saturday Daylight Planner](/cafe=saturday) page, which lists all the races that are predicted to be in daylight on the next Saturday at 4pm.
    - Added Circuit tag to SRV circuit races

## 2026-06-27
- Index page:
    - Now has coverage showing all races' current day/night state (where known).  There's no need to go to a race page first.  Thanks to @LouisH99 for implementing the buik races API that drives this.
    - You can also see how long it is day/night for on the index cards.  eg.  "☀️ for 16h"  or  "🌙 for 3h".
- Races list page:
    - Added rival filter to the /races-list page.
        - Do you have a rival who has no right to be ahead of you in any races? Then this is the tool for you!
- Stats page:
    - Various layout tweaks / reordering.
    - Added a table about one-time racers as I was curious to see if any particular races were associated with people not returning.


## 2026-06-20
- Challenges:
    - Added a "challenges" page that gives an achievements style list of stuff you can do.
- Stats page:
    - Added graphs and other visual elements.


## 2026-06-08

- General:
    - Added day/night reporting!
        - If the day/night state of a race is known it will be displayed on the race page.
        - Once it has been shown, the value feeds back to the index page. An icon is shown on the race card showing the day/night state. Items on the index page can now be filtered to show just day only.
        - If the day/night state of a race is unknown a link is shown to enable you to submit an observation and inform the model.
        - Many thanks to Louish99 for this. Its all his hard work - he just provided the capabilty for this site to display it.  https://eddaynight.de/
    - Added DW3 badges to DW3 races
    - Auto-update of your current system.
         - If you've got the site open on the race page or activity page when you complete a race the "current system" will be updated to the system that the race took place on.
         - NB: The "current system" is used for distance-based sorting and filtering on the "Not Yet Done" races on the cmdr page and on the /races-list page.
- Stats page:
    - Added "Biggest leaders" and "Closest finishes" tables
    - Fixed some misreporting of DW3 races
    - Updated the golds/podium finishes tables to make a single medals table.

## 2026-06-01

- Index page:
    - Added sort options to the main list of races.
    - The New races panel now looks back 30 days*.
        - * at the moment its only 14 days, but I will increase it to 30 days in mid June, once the last of the DW3 races have expired.
    - It only lists races that are both new and not yet done.
- Activity page:
    - Added the above races panel here too.
    - Added infinite scroll to enable you to see more activities.
    - Updated the emoji for 1st place from 🥇 to 🏆 so that it is more visually distinct from the 3rd place medal (🥉).
- About page:
    - Added links to the Discord servers and other time trials sites.

Thanks to @vr247 and @nastynate1 for these suggestions.


## 2026-05-10

- Race page:
    - Added ability to filter races by ship size / type
- Cmdr page:
    - Participation progress bars showing how many of each type of race you've completed
- Creator page: New page for race creators!
    - [Creators index page](/creators) showing all race creators with race counts by type (Ship, Fighter, SRV, On Foot)
    - Individual creator pages at `/creator/{name}` displaying all races created by that commander, grouped by race type
- Recent Thefts page: New page for recent trophy thefts
    - Shows all recent podium thefts.


## 2026-05-03

- Cmdr page:
    - Moved the trophies section above the Rankings tables.
    - The Opportunities section now auto-shows if you've set a system name
    - Added inara profile image and link
- Race page:
    - Added ship names to the table (how did I miss this before?!)
- [About me](/about-me) - a page all about meeeeeee because I'm so vain!
- [Change log](/changelog) - a page containing this change log

### Aside
I continue to amuse myself by looking at players ship names and trying to work out the naming scheme.
eg. Skyrim locations (Greaves); Birds (Willie Eckerslike); Culture Ships? (Arc Sec).
And then there are those truly bizarre ones (I'm looking at you Cmdr Ed Pork).
![pigs in space](https://static.klipy.com/ii/71b2873e478b9d8d0482ea3ec777ba7f/7d/42/CbC386Ez.gif)

Can you guess mine? The older members of the fleet stuck to a tighter naming scheme.


## 2026-04-25

I've been busy this week on https://elitettleaderboard.vladigor.net/
Here's a list of changes I've made:

- Home page:
    - Added text search filter
    - Added filter to hide DW3 races
    - Added filter to hide legacy Horizons races
    - Added badges to Horizons races
- Race pages:
    - Added maps to race pages
    - Added media links to race pages
    - Linked through to https://frinkbottle.uk/TimeTrials/ for maps for bubble races
    - Made race constraints nicer to read
- Cmdr page:
    - Added some more characters to the trophy thefts section
    - Added a couple of statuses to trophy thefts section:
        - Redemption (the thief lost the trophy and you overtook them)
        - Dropped (the thief no longer holds this trophy)
- Stats page:
    - Extended stats page to show more results
    - And more random stats I thought up, like popular ship names and neglected races


## 2026-04-18

I've made a few updates to my leaderboards site this week:

- I've added a [Recent Activity](/activity) page for those who are curious about what everyone else is doing, or keen on monitoring their leaderboard positions:
- I've added a [Stats](/stats) page with a few interesting facts from the races data.
- I've added more variety to the trophy thefts messages.
- I've updated the trophy thefts section to show reclaimed trophies (when you've won them back)
- I've added a map to the race page for some of the recent DW3 races.
    - The maps might not be sustainable long term as it involves me manually uploading them, but I found them helpful when learning this week's courses.
    - If you have maps for older courses send them my way in a PM or something.
    - I'm also mulling over the idea of adding links to videos of the demo runs.
