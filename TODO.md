✓ On the importer, check if the file is open/locked before trying to do anything. Don't import locked/open files!
✓ Autoplay isn't moving onto the next (more recent) file after it finishes playing. It should move up one file at a time, and if its at the most recent file, do nothing until the browser-database is updated with new data, and then move up one row.
✓ Default to having all channels for a system selected whenever you select a system. And default to the only system if there is only one. Single left click should select ONLY that channel. Command-click should select or unselect multiple. If none are selected, show no transmissions - don't default to all.
✓ When initially querying, we should make sure the DB is sorted by most-recent matching the filters, and return the top 50. It seems to not be pre-sorted when querying.
✓ Use the websocket for all querying. We should connect the websocket and then issue requests to it. Merge the state in the local database, and dedupe via transmission_id, preferring the most-recent copy. When we change filters, clear the entire local state, and accept only what the websocket returns after that point. Always re-filter incoming data based on the current filters.
✓ Add info logging around task creation/completion and around WS connects / messages.
✓ Do infinite scroll, with the load-more fallback.
✓ Change the docker-compose and integrations to use speaches.ai - docker run \
  --rm \
  --detach \
  --publish 8000:8000 \
  --name speaches \
  --volume hf-hub-cache:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:latest-cpu
  but in docker compose
✓ Don't use the created_at to replace the transmission in the database - always replace with the latest from the websocket
✓ Make the uploader multi-threaded (or multiprocess) for each file, so we don't block the whole queue when waiting. And try to use python open-file modes with write exclusivity to test if the file is closed or not.
✓ Create a TODOs folder, and add some thoughts about how to maintain the in-memory browser side database, specifically around pruning the older-records as one is autoplaying for hours upon hours.
✓ Create a way to store prompts for transcription on channel and station. We will send both of them. Add npx commands to make this easy. Add aliases in the docker container for these commands so that I can just docker exec <command name> and have it work as expected.
✓ Update the importer config to accept prefixed environment variables (like, RADIO_CAPTURE_IMPORTER_XYZ) as well, so we can override the default config on the docker container via environment variables. We should bake in an empty, basic config.
✓ Move auto-create to a server-side flag only. It shouldn't be part of the importer. Importer should have to just specify channel name and it should have to be an exact match. As the API Key is scoped to a specific station, the importer shouldn't need to query anything about channels/stations, and those endpoints shouldn't eixst.