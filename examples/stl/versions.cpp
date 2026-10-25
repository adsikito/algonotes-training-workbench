#include <iostream>
#include <map>
#include <string>
#include <numeric>
#include <limits>
int main(){
 std::map<int,std::string> m;m.emplace(1,"one");
 std::pair<std::map<int,std::string>::iterator,bool> a=m.try_emplace(1,"ignored"),b=m.insert_or_assign(1,"uno");
 std::cout<<a.second<<' '<<b.second<<' '<<m.at(1)<<'\n';
 std::map<int,std::string>::node_type node=m.extract(1);if(!node.empty()){node.key()=3;m.insert(std::move(node));}
 std::map<int,std::string> other{{3,"tres"},{4,"four"}};m.merge(other);
 std::cout<<m.size()<<' '<<other.size()<<' '<<m.at(3)<<'\n';
 std::cout<<std::gcd(18,24)<<' '<<std::lcm(18,24)<<' '<<(std::numeric_limits<long long>::digits>=63)<<'\n';
}
