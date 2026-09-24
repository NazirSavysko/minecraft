scoreboard players add @s rocket_launch 1
execute as @s[scores={rocket_launch=1..15}] at @s run tp @s ~ ~ ~ ~ ~-1.8
execute as @s[scores={rocket_launch=16..40}] at @s run tp @s ~ ~ ~ ~ ~1.1
execute as @s at @s run tp @s ^ ^ ^0.9 ~ ~
scoreboard players add @s rocket_snd 1
execute as @s[type=!rocket:missile7,scores={rocket_snd=248..}] run stopsound @a custom.shahed3.fly
execute as @s[type=!rocket:missile7,scores={rocket_snd=248..}] at @s run playsound custom.shahed3.fly @a ~ ~ ~ 10.0 0.8
execute as @s[scores={rocket_snd=248..}] at @s run playsound ambient.weather.thunder @a ~ ~ ~ 0.5 0.35
execute as @s[scores={rocket_snd=248..}] run scoreboard players set @s rocket_snd 0
execute as @s[scores={rocket_launch=7..}] at @s unless block ^ ^ ^1.8 air run event entity @s rocket:explode
