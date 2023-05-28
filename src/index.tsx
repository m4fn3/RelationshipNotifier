import {Plugin, registerPlugin} from 'enmity/managers/plugins'
import {Dialog, React, Users} from 'enmity/metro/common'
import {create} from 'enmity/patcher'
// @ts-ignore
import manifest, {name as plugin_name} from '../manifest.json'
import Settings from "./components/Settings"
import {getStoreHandlers} from "../../hook"
import {bulk, filters} from "enmity/modules"
import {get, set} from "enmity/api/settings"

const [
    GuildStore,
    ChannelStore,
    RelationshipStore
] = [
    getStoreHandlers("GuildStore"),
    getStoreHandlers("ChannelStore"), // CHANNEL_DELETE
    getStoreHandlers("RelationshipStore") // RELATIONSHIP_REMOVE
]

const [
    GuildStoreReal,
    ChannelStoreReal,
    RelationshipStoreReal,
    RelationshipActions,
    GuildActions,
    GroupActions
] = bulk(
    filters.byProps("getGuilds"),
    filters.byProps("getSortedPrivateChannels"),
    filters.byProps("getRelationships"),
    filters.byProps("removeRelationship"),
    filters.byProps("leaveGuild"),
    filters.byProps("closePrivateChannel")
)

function l(text){
    // console.log(text)
}

const Patcher = create('RelationshipNotifier')

const RelationshipNotifier: Plugin = {
    ...manifest,
    onStart() {
        let leftGuild = undefined
        let closedGroup = undefined
        let removedFriend = undefined
        Patcher.after(RelationshipActions, "removeRelationship", (self, args, res) => {
            l("- removeRelationship()")
            removedFriend = args[0]
            l(removedFriend)
        })
        Patcher.after(GuildActions, "leaveGuild", (self, args, res) => {
            l("- leaveGuild()")
            leftGuild = args[0]
            l(leftGuild)
        })
        Patcher.after(GroupActions, "closePrivateChannel", (self, args, res) => {
            l("- closePrivateChannel()")
            closedGroup = args[0]
            l(closedGroup)
        })

        function syncGuilds() {
            l("- syncGuilds()")
            const guilds = GuildStoreReal.getGuilds()
            let guildData = {}
            const me = Users.getCurrentUser()
            Object.keys(guilds).forEach(guildId => {
                guildData[guildId] = {
                    name: guilds[guildId].name,
                    icon: guilds[guildId].icon && `https://cdn.discordapp.com/icons/${guildId}/${guilds[guildId].icon}.png`
                }
            })
            // l(guilds)
            // l(guildData)
            set(plugin_name, `guilds-${me.id}`, JSON.stringify(guildData))
        }

        function syncGroups() {
            l("- syncGroups()")
            const privateChannels = ChannelStoreReal.getSortedPrivateChannels()
            let groupData = {}
            const me = Users.getCurrentUser()
            privateChannels.forEach(channel => {
                if (channel.type !== 3) return
                groupData[channel.id] = {
                    name: channel.name || channel.rawRecipients.map(r => r.username).join(", "),
                    icon: channel.icon && `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png`
                }
            })
            // l(groupData)
            set(plugin_name, `groups-${me.id}`, JSON.stringify(groupData))
        }

        function syncFriends() {
            l("- syncFriends()")
            const relationShips = RelationshipStoreReal.getRelationships()
            let friendsData = {
                "friends": {},
                "requests": {}
            }
            const me = Users.getCurrentUser()
            for (const userId of Object.keys(relationShips)) {
                const relationShipType = relationShips[userId]
                let user = Users.getUser(userId)
                if (relationShipType === 1) {
                    friendsData.friends[userId] = user ? `${user.username}#${user.discriminator}` : userId
                } else if (relationShipType === 3) {
                    friendsData.requests[userId] = user ? `${user.username}#${user.discriminator}` : userId
                }
            }
            // l(relationShips)
            // l(friendsData)
            set(plugin_name, `friends-${me.id}`, JSON.stringify(friendsData))
        }

        function checkAll() {
            l("- checkAll()")
            const me = Users.getCurrentUser()
            // check guild
            const cachedGuilds = JSON.parse(get(plugin_name, `guilds-${me.id}`, "{}").toString())
            const guilds = Object.keys(GuildStoreReal.getGuilds())
            const removedGuilds = Object.keys(cachedGuilds).filter(guildId => !guilds.includes(guildId)).map(guildId => cachedGuilds[guildId])
            // check groups
            const cachedGroups = JSON.parse(get(plugin_name, `groups-${me.id}`, "{}").toString())
            const groups = ChannelStoreReal.getSortedPrivateChannels().filter(channel => channel.type === 3).map(channel => channel.id)
            const removedGroups = Object.keys(cachedGroups).filter(channelId => !groups.includes(channelId)).map(channelId => cachedGroups[channelId])
            // check friends
            const cachedFriends = JSON.parse(get(plugin_name, `friends-${me.id}`, '{"friends":{},"requests":{}}').toString())
            const relationShips = Object.keys(RelationshipStoreReal.getRelationships())
            const removedFriends = Object.keys(cachedFriends.friends).filter(userId => !relationShips.includes(userId)).map(userId => cachedFriends.friends[userId])
            const removedRequests = Object.keys(cachedFriends.requests).filter(userId => !relationShips.includes(userId)).map(userId => cachedFriends.requests[userId])
            // create notice
            let content = "Following relation ships have been removed.\n"
            if (removedGuilds.length) content += "Server:\n  " + removedGuilds.map(guild => guild.name).join(", ")
            if (removedGroups.length) content += "Group:\n  " + removedGroups.map(channel => channel.name).join(", ")
            if (removedFriends.length) content += "Friends:\n  " + removedFriends.join(", ")
            if (removedRequests.length) content += "Requests:\n  " + removedRequests.join(", ")
            if (content.length > 44) {
                Dialog.show({
                    title: "RelationshipNotifier",
                    body: content,
                    confirmText: "Dismiss"
                })
            }
        }

        // we can get relationships only after CONNECTION_OPEN of **RelationshipStore** is called
        Patcher.after(RelationshipStore, "CONNECTION_OPEN", (self, args, res) => {
            checkAll()
            syncGuilds()
            syncGroups()
            syncFriends()
        })
        Patcher.after(GuildStore, "GUILD_DELETE", (self, args, res) => {
            l("- GUILD_DELETE()")
            // l(args)
            const me = Users.getCurrentUser()
            const cachedGuilds = JSON.parse(get(plugin_name, `guilds-${me.id}`, "{}").toString())
            // l(cachedGuilds)
            if (args[0].guild?.id && cachedGuilds[args[0].guild.id]) {
                l(leftGuild)
                l(args[0].guild.id)
                if (leftGuild && leftGuild === args[0].guild.id) {
                    leftGuild = undefined
                } else {
                    Dialog.show({
                        title: "RelationshipNotifier",
                        body: `Following relation ships have been removed.\nServer:\n  ${cachedGuilds[args[0].guild.id].name}`,
                        confirmText: "Dismiss"
                    })
                }
                delete cachedGuilds[args[0].guild.id]
                set(plugin_name, `guilds-${me.id}`, JSON.stringify(cachedGuilds))
            }
        })
        Patcher.after(GuildStore, "GUILD_CREATE", (self, args, res) => {
            syncGuilds()
        })
        Patcher.after(ChannelStore, "CHANNEL_DELETE", (self, args, res) => {
            setTimeout(() => { // delay to check if it's called by a manual action
                l("- CHANNEL_DELETE")
                const me = Users.getCurrentUser()
                const cachedGroups = JSON.parse(get(plugin_name, `groups-${me.id}`, "{}").toString())
                if (args[0].channel?.id && cachedGroups[args[0].channel.id]) {
                    l(closedGroup)
                    l(args[0].channel.id)
                    if (closedGroup && closedGroup === args[0].channel.id) {
                        closedGroup = undefined
                    } else {
                        Dialog.show({
                            title: "RelationshipNotifier",
                            body: `Following relation ships have been removed.\nGroup:\n  ${cachedGroups[args[0].channel.id].name}`,
                            confirmText: "Dismiss"
                        })
                    }
                    delete cachedGroups[args[0].channel.id]
                    set(plugin_name, `groups-${me.id}`, JSON.stringify(cachedGroups))
                }
            }, 500)
        })
        Patcher.after(ChannelStore, "CHANNEL_CREATE", (self, args, res) => {
            syncGroups()
        })
        Patcher.after(RelationshipStore, "RELATIONSHIP_REMOVE", (self, args, res) => {
            l("- RELATIONSHIP_REMOVE")
            const me = Users.getCurrentUser()
            const cachedFriends = JSON.parse(get(plugin_name, `friends-${me.id}`, '{"friends":{},"requests":{}}').toString())
            if (args[0].relationship?.type === 1 && Object.keys(cachedFriends.friends).includes(args[0].relationship?.id)) {
                l(removedFriend)
                l(args[0].relationship?.id)
                if (removedFriend && removedFriend === args[0].relationship?.id) {
                    removedFriend = undefined
                } else {
                    Dialog.show({
                        title: "RelationshipNotifier",
                        body: `Following relation ships have been removed.\nFriend:\n  ${args[0].relationship?.id}`,
                        confirmText: "Dismiss"
                    })
                }
                // cachedFriends.friends.splice(cachedFriends.friends.indexOf(args[0].relationship?.id), 1)
                delete cachedFriends.friends[args[0].relationship?.id]
                set(plugin_name, `friends-${me.id}`, JSON.stringify(cachedFriends))
            } else if (args[0].relationship?.type === 3 && Object.keys(cachedFriends.requests).includes(args[0].relationship?.id)) {
                if (removedFriend && removedFriend === args[0].relationship?.id) {
                    removedFriend = undefined
                } else {
                    Dialog.show({
                        title: "RelationshipNotifier",
                        body: `Following relation ships have been removed.\nRequest:\n  ${args[0].relationship?.id}`,
                        confirmText: "Dismiss"
                    })
                }
                // cachedFriends.requests.splice(cachedFriends.requests.indexOf(args[0].relationship?.id), 1)
                delete cachedFriends.requests[args[0].relationship?.id]
                set(plugin_name, `friends-${me.id}`, JSON.stringify(cachedFriends))
            }
            syncFriends()
        })
        Patcher.after(RelationshipStore, "RELATIONSHIP_ADD", (self, args, res) => {
            syncFriends()
        })
    },
    onStop() {
        Patcher.unpatchAll()
    }
    ,
    getSettingsPanel({settings}) {
        return <Settings settings={settings}/>
    }
}

registerPlugin(RelationshipNotifier)
