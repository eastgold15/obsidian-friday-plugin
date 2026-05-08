#!/bin/bash

# CouchDB official image runs as UID 5984 (couchdb user)
# Host-mounted data directories must be writable by this user
if [ -d "data/couchdb" ]; then
    chown -R 5984:5984 "data/couchdb"
fi
